use std::io::Cursor;

use image::codecs::gif::GifDecoder;
use image::{AnimationDecoder, RgbaImage};

use super::video::{rgba_to_512, write_animated};

const MAX_DURATION_MS: u64 = 7000;
const TARGET_FPS: u64 = 24;
const MAX_FRAMES: usize = 168;
// decode cap: headroom for stride sampling, bounds time/RAM on hostile gifs
const DECODE_CAP: usize = MAX_FRAMES * 4;

pub fn convert_gif(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let decoder = GifDecoder::new(Cursor::new(data))?;
  let mut frames: Vec<(RgbaImage, u32)> = Vec::new();
  let mut total_ms: u64 = 0;
  for item in decoder.into_frames().take(DECODE_CAP) {
    let frame = item?;
    let (n, d) = frame.delay().numer_denom_ms();
    // 0 delay = render ASAP in browsers; default to 100ms like they do
    let ms = if n == 0 { 100 } else { (n as u64 / d.max(1) as u64).clamp(10, 2000) };
    total_ms += ms;
    frames.push((rgba_to_512(&frame.into_buffer()), ms.min(2000) as u32));
    if total_ms >= MAX_DURATION_MS {
      break;
    }
  }
  if frames.is_empty() {
    return Err("no decodable frames".into());
  }

  let total = total_ms.min(MAX_DURATION_MS) as u32;
  let target = (((total as u64 * TARGET_FPS) / 1000).min(MAX_FRAMES as u64).max(1)) as usize;
  let stride = (frames.len().div_ceil(target)).max(1);
  let kept: Vec<(RgbaImage, u32)> = frames
    .into_iter()
    .enumerate()
    .filter(|(i, _)| i % stride == 0)
    .map(|(_, f)| f)
    .collect();
  let kept_total: u32 = kept.iter().map(|(_, ms)| *ms).sum::<u32>().max(1);
  write_animated(
    &kept.into_iter().map(|(img, _)| img).collect::<Vec<_>>(),
    kept_total,
    output,
  )
}

#[cfg(test)]
mod tests {
  use super::*;

  fn sample_gif() -> Vec<u8> {
    let mut buf = Vec::new();
    {
      let mut enc = image::codecs::gif::GifEncoder::new(&mut buf);
      for c in [[255u8, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]] {
        let img = RgbaImage::from_pixel(8, 8, image::Rgba(c));
        let frame =
          image::Frame::from_parts(img, 0, 0, image::Delay::from_numer_denom_ms(100, 1));
        enc.encode_frame(frame).unwrap();
      }
    }
    buf
  }

  #[test]
  fn gif_magic_detected() {
    assert!(super::super::is_gif(&sample_gif()));
    assert!(!super::super::is_gif(b"RIFF....WEBP"));
  }

  #[test]
  fn animated_gif_converts_to_webp() {
    let data = sample_gif();
    let out = std::env::temp_dir().join(format!("wakaru-test-{}.webp", std::process::id()));
    convert_gif(&data, out.to_str().unwrap()).unwrap();
    let bytes = std::fs::read(&out).unwrap();
    std::fs::remove_file(&out).ok();
    assert!(&bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP");
    assert!(bytes.len() < 500 * 1024);
  }
}
