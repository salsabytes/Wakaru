use std::io::Cursor;

use image::imageops::FilterType;
use image::RgbaImage;
use mp4::{MediaType, Mp4Reader};
use openh264::decoder::{Decoder, DecoderConfig, Flush};
use openh264::formats::YUVSource;
use openh264::OpenH264API;
use webp_animation::prelude::*;

const SIZE: u32 = 512;
const MAX_FRAMES: usize = 120;
const MAX_DURATION_MS: u32 = 10000;
const TARGET_FPS: u32 = 12;
const MAX_BYTES: usize = 500 * 1024;

pub fn convert_video(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let mut mp4 = Mp4Reader::read_header(Cursor::new(data), data.len() as u64)?;

  let track = mp4
    .tracks()
    .values()
    .find(|t| matches!(t.media_type(), Ok(MediaType::H264)))
    .ok_or("no H.264 video track found")?;

  let track_id = track.track_id();
  let total_raw = track.duration().as_millis() as u32;
  let total_ms = total_raw.clamp(1, MAX_DURATION_MS);
  let sample_count = track.sample_count();
  let cap = if total_raw > MAX_DURATION_MS {
    ((sample_count as u64 * MAX_DURATION_MS as u64) / total_raw as u64).max(1) as u32
  } else {
    sample_count
  };

  let avc1 = track
    .trak
    .mdia
    .minf
    .stbl
    .stsd
    .avc1
    .as_ref()
    .ok_or("no avc1 sample entry")?;
  let avcc = &avc1.avcc;
  let length_size = avcc.length_size_minus_one + 1;
  let sps: Vec<Vec<u8>> = avcc.sequence_parameter_sets.iter().map(|s| s.bytes.clone()).collect();
  let pps: Vec<Vec<u8>> = avcc.picture_parameter_sets.iter().map(|p| p.bytes.clone()).collect();

  let target_frames = (((total_ms / 1000) as u32) * TARGET_FPS)
    .min(MAX_FRAMES as u32)
    .max(1) as usize;
  let stride = ((cap as usize).div_ceil(target_frames)).max(1);

  let mut decoder = Decoder::with_api_config(
    OpenH264API::from_source(),
    DecoderConfig::new().flush_after_decode(Flush::NoFlush),
  )?;
  let mut buffer = Vec::new();
  let mut frames: Vec<RgbaImage> = Vec::with_capacity(target_frames);

  for i in 1..=cap {
    let Some(sample) = mp4.read_sample(track_id, i)? else {
      continue;
    };
    avc_to_annex_b(&sample.bytes, length_size, &sps, &pps, &mut buffer);
    match decoder.decode(&buffer) {      Ok(Some(img)) => {
        // skip strided frames BEFORE converting YUV->RGB (decode is mandatory, conversion is not)
        if ((i - 1) as usize) % stride != 0 {
          continue;
        }
        let (fw, fh) = img.dimensions();
        let mut rgb_buf = match fw.checked_mul(fh).and_then(|n| n.checked_mul(3)) {
          Some(n) => vec![0u8; n],
          None => continue,
        };
        img.write_rgb8(&mut rgb_buf);
        let Some(canvas) = frame_to_512(&rgb_buf, fw as u32, fh as u32) else {
          continue;
        };
        frames.push(canvas);
        if frames.len() >= target_frames {
          break;
        }
      }
      _ => continue,
    }
  }

  if frames.is_empty() {
    return Err("no decodable frames".into());
  }

  write_animated(&frames, total_ms, output)
}

fn avc_to_annex_b(sample: &[u8], length_size: u8, sps: &[Vec<u8>], pps: &[Vec<u8>], out: &mut Vec<u8>) {
  out.clear();
  let mut i = 0;
  let ls = length_size as usize;
  let mut first_idr = true;
  while i + ls <= sample.len() {
    let mut n: usize = 0;
    for _ in 0..ls {
      n = (n << 8) | sample[i] as usize;
      i += 1;
    }
    if n == 0 || i + n > sample.len() {
      break;
    }
    let nal = &sample[i..i + n];
    i += n;
    if nal[0] & 0x1f == 5 && first_idr {
      first_idr = false;
      for s in sps {
        out.extend_from_slice(&[0, 0, 1]);
        out.extend_from_slice(s);
      }
      for p in pps {
        out.extend_from_slice(&[0, 0, 1]);
        out.extend_from_slice(p);
      }
    }
    out.extend_from_slice(&[0, 0, 1]);
    out.extend_from_slice(nal);
  }
}

fn frame_to_512(rgb: &[u8], w: u32, h: u32) -> Option<RgbaImage> {
  let img = image::RgbImage::from_raw(w, h, rgb.to_vec())?;
  let scale = SIZE as f32 / w.max(h) as f32;
  let (nw, nh) = if scale < 1.0 {
    (((w as f32 * scale) as u32).max(1), ((h as f32 * scale) as u32).max(1))
  } else {
    (w, h)
  };
  let resized = image::DynamicImage::ImageRgb8(image::imageops::resize(&img, nw, nh, FilterType::Triangle))
    .to_rgba8();
  let mut canvas = RgbaImage::from_pixel(SIZE, SIZE, image::Rgba([0, 0, 0, 255]));
  image::imageops::overlay(&mut canvas, &resized, ((SIZE - nw) / 2) as i64, ((SIZE - nh) / 2) as i64);
  Some(canvas)
}

fn write_animated(frames: &[RgbaImage], total_ms: u32, output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let total = total_ms.max(100);
  let dms = ((total as usize / frames.len()).max(1)) as i32;
  let options = EncoderOptions {
    encoding_config: Some(EncodingConfig::new_lossy(70.0)),
    ..Default::default()
  };
  let mut encoder = Encoder::new_with_options((SIZE, SIZE), options)?;
  for (j, frame) in frames.iter().enumerate() {
    encoder.add_frame(frame.as_raw(), (j as i32) * dms)?;
  }
  let done = encoder.finalize(total as i32)?;

  if done.as_ref().len() <= MAX_BYTES {
    std::fs::write(output, done.as_ref())?;
    return Ok(());
  }
  let mut encoder = Encoder::new_with_options(
    (SIZE, SIZE),
    EncoderOptions {
      encoding_config: Some(EncodingConfig::new_lossy(45.0)),
      ..Default::default()
    },
  )?;
  for (j, frame) in frames.iter().enumerate() {
    encoder.add_frame(frame.as_raw(), (j as i32) * dms)?;
  }
  let done = encoder.finalize(total as i32)?;
  if done.as_ref().len() <= MAX_BYTES {
    std::fs::write(output, done.as_ref())?;
    return Ok(());
  }

  for (stride, quality) in [(2, 45.0), (4, 45.0), (8, 45.0), (8, 35.0)] {
    let n = frames.len().div_ceil(stride);
    let dms = ((total as usize / n).max(1)) as i32;
    let mut encoder = Encoder::new_with_options(
      (SIZE, SIZE),
      EncoderOptions {
        encoding_config: Some(EncodingConfig::new_lossy(quality)),
        ..Default::default()
      },
    )?;
    for (j, frame) in frames.iter().step_by(stride).enumerate() {
      encoder.add_frame(frame.as_raw(), (j as i32) * dms)?;
    }
    let done = encoder.finalize(total as i32)?;
    if done.as_ref().len() <= MAX_BYTES {
      std::fs::write(output, done.as_ref())?;
      return Ok(());
    }
  }
  Err(format!("animated sticker too large after compression ({} frames, {}ms)", frames.len(), total).into())
}
