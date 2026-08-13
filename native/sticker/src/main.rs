mod video;

use std::env;
use std::fs;
use std::io::{BufWriter, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::ExitCode;

use image::imageops::FilterType;
use image::GenericImageView;

const SIZE: u32 = 512;

fn main() -> ExitCode {
  let args: Vec<String> = env::args().skip(1).collect();
  // optional trailing pack/author → embedded as WhatsApp sticker EXIF metadata
  if args.len() != 2 && args.len() != 4 {
    eprintln!("usage: sticker <input> <output> [pack author]");
    return ExitCode::FAILURE;
  }
  let data = match fs::read(&args[0]) {
    Ok(d) => d,
    Err(e) => {
      eprintln!("sticker: {e}");
      return ExitCode::FAILURE;
    }
  };
  let result = match catch_unwind(AssertUnwindSafe(|| {
    if is_mp4(&data) {
      video::convert_video(&data, &args[1])
    } else {
      convert_image(&data, &args[1])
    }
  })) {
    Ok(r) => r,
    Err(payload) => {
      let msg = payload
        .downcast_ref::<&str>()
        .map(|s| s.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_string());
      eprintln!("sticker: internal panic: {msg}");
      return ExitCode::FAILURE;
    }
  };
  match result {
    Ok(()) => {
      if let (Some(pack), Some(author)) = (args.get(2), args.get(3)) {
        if let Err(e) = add_exif(&args[1], pack, author) {
          eprintln!("sticker: {e}");
          return ExitCode::FAILURE;
        }
      }
      ExitCode::SUCCESS
    }
    Err(e) => {
      eprintln!("sticker: {e}");
      ExitCode::FAILURE
    }
  }
}

// WhatsApp reads a custom EXIF tag (0x5741, type UNDEFINED) whose payload names the
// sticker pack/author. Format: 22-byte TIFF header + JSON payload (same bytes as
// wa-sticker-formatter); byte 14 holds the payload length (LE).
fn build_exif(pack: &str, author: &str) -> Vec<u8> {
  let payload = format!(
    "{{\"sticker-pack-id\":\"wakaru\",\"sticker-pack-name\":\"{}\",\"sticker-pack-publisher\":\"{}\",\"emojis\":[]}}",
    json_str(pack),
    json_str(author)
  );
  let mut exif = vec![
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ];
  exif[14..18].copy_from_slice(&(payload.len() as u32).to_le_bytes());
  exif.extend_from_slice(payload.as_bytes());
  exif
}

fn json_str(s: &str) -> String {
  s.replace('\\', "\\\\")
    .replace('"', "\\\"")
    .replace('\n', "\\n")
    .replace('\r', "\\r")
    .replace('\t', "\\t")
}

fn add_exif(path: &str, pack: &str, author: &str) -> Result<(), Box<dyn std::error::Error>> {
  let webp = fs::read(path)?;
  let out = inject_exif(&webp, &build_exif(pack, author))?;
  fs::write(path, out)?;
  Ok(())
}

// WebP EXIF lives in its own RIFF chunk, which per spec requires a VP8X chunk with
// the EXIF flag (0x08) set — and the EXIF chunk goes AFTER the image data
// (VP8X → ICCP → ANIM → ANMF… → EXIF → XMP), matching node-webpmux/wa-sticker-formatter.
// Video output already has VP8X (just set the flag); a plain VP8/VP8L image gets a
// VP8X built from the known 512×512 canvas.
fn inject_exif(webp: &[u8], exif: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
  if webp.len() < 12 || &webp[0..4] != b"RIFF" || &webp[8..12] != b"WEBP" {
    return Err("not a webp".into());
  }
  let mut chunks: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
  let mut i = 12usize;
  while i + 8 <= webp.len() {
    let fourcc = webp[i..i + 4].to_vec();
    let size = u32::from_le_bytes(webp[i + 4..i + 8].try_into().unwrap()) as usize;
    let start = i + 8;
    if start + size > webp.len() {
      break;
    }
    chunks.push((fourcc, webp[start..start + size].to_vec()));
    i = start + size + (size & 1); // chunks are padded to even length
  }
  if chunks.is_empty() {
    return Err("no webp chunks found".into());
  }

  let mut out = Vec::with_capacity(webp.len() + exif.len() + 64);
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&[0u8; 4]); // size patched at the end
  out.extend_from_slice(b"WEBP");

  let mut rest = chunks.into_iter();
  if let Some((fourcc, mut data)) = rest.next() {
    if fourcc == b"VP8X" {
      if !data.is_empty() {
        data[0] |= 0x08; // EXIF present
      }
      push_chunk(&mut out, &fourcc, &data);
    } else {
      let mut vp8x = vec![0u8; 10];
      vp8x[0] = 0x08; // EXIF present
      let d = (SIZE - 1).to_le_bytes();
      vp8x[4..7].copy_from_slice(&d[..3]);
      vp8x[7..10].copy_from_slice(&d[..3]);
      push_chunk(&mut out, b"VP8X", &vp8x);
      push_chunk(&mut out, &fourcc, &data);
    }
  }
  // image/data chunks keep their original order (ICCP, ANIM, ANMF, VP8, VP8L, ALPH…)
  for (fourcc, data) in rest {
    push_chunk(&mut out, &fourcc, &data);
  }
  push_chunk(&mut out, b"EXIF", exif);

  let size = (out.len() - 8) as u32;
  out[4..8].copy_from_slice(&size.to_le_bytes());
  Ok(out)
}

fn push_chunk(out: &mut Vec<u8>, fourcc: &[u8], data: &[u8]) {
  out.extend_from_slice(fourcc);
  out.extend_from_slice(&(data.len() as u32).to_le_bytes());
  out.extend_from_slice(data);
  if data.len() & 1 == 1 {
    out.push(0);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn riff(fourcc: &[u8], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(b"WEBP");
    push_chunk(&mut out, fourcc, data);
    let size = (out.len() - 8) as u32;
    out[4..8].copy_from_slice(&size.to_le_bytes());
    out
  }

  fn chunks(out: &[u8]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut res = Vec::new();
    let mut i = 12usize;
    while i + 8 <= out.len() {
      let fourcc = out[i..i + 4].to_vec();
      let size = u32::from_le_bytes(out[i + 4..i + 8].try_into().unwrap()) as usize;
      res.push((fourcc, out[i + 8..i + 8 + size].to_vec()));
      i = i + 8 + size + (size & 1);
    }
    res
  }

  #[test]
  fn simple_webp_gets_vp8x_and_exif() {
    let webp = riff(b"VP8 ", &[1, 2, 3]);
    let exif = build_exif("rawr", "buatan gweh");
    let out = inject_exif(&webp, &exif).unwrap();
    assert_eq!((out.len() - 8) as u32, u32::from_le_bytes(out[4..8].try_into().unwrap()));
    let cs = chunks(&out);
    assert_eq!(cs.len(), 3);
    assert_eq!(cs[0].0, b"VP8X");
    assert_eq!(cs[0].1[0] & 0x08, 0x08); // EXIF flag
    assert_eq!(cs[0].1[4..7], [0xff, 0x01, 0x00]); // 512 - 1
    assert_eq!(cs[1].0, b"VP8 "); // image data first…
    assert_eq!(cs[1].1, [1, 2, 3]);
    assert_eq!(cs[2].0, b"EXIF"); // …EXIF after, per container spec
    assert_eq!(
      &cs[2].1[22..],
      b"{\"sticker-pack-id\":\"wakaru\",\"sticker-pack-name\":\"rawr\",\"sticker-pack-publisher\":\"buatan gweh\",\"emojis\":[]}"
    );
  }

  #[test]
  fn extended_webp_keeps_order_and_sets_flag() {
    let mut webp = riff(b"VP8X", &[0x10, 0, 0, 0, 0xff, 0x01, 0x00, 0xff, 0x01, 0x00]);
    push_chunk(&mut webp, b"VP8 ", &[9]);
    let size = (webp.len() - 8) as u32;
    webp[4..8].copy_from_slice(&size.to_le_bytes());
    let out = inject_exif(&webp, &build_exif("a", "b")).unwrap();
    let cs = chunks(&out);
    assert_eq!(cs.len(), 3);
    assert_eq!(cs[0].0, b"VP8X");
    assert_eq!(cs[0].1[0], 0x18); // 0x10 | EXIF
    assert_eq!(cs[1].0, b"VP8 "); // image data first…
    assert_eq!(cs[2].0, b"EXIF"); // …EXIF after
  }
}

fn is_mp4(data: &[u8]) -> bool {
  data.len() >= 12 && &data[4..8] == b"ftyp"
}

fn convert_image(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let img = image::load_from_memory(data)?;
  let (w, h) = img.dimensions();
  // always fill the longer side to SIZE (upscale small sources too); the leftover
  // letterbox stays transparent instead of black
  let scale = SIZE as f32 / w.max(h) as f32;
  let (nw, nh) = (((w as f32 * scale) as u32).max(1), ((h as f32 * scale) as u32).max(1));
  let resized = img.resize(nw, nh, FilterType::Lanczos3).to_rgba8();
  let mut canvas = image::RgbaImage::from_pixel(SIZE, SIZE, image::Rgba([0, 0, 0, 0]));
  image::imageops::overlay(
    &mut canvas,
    &resized,
    ((SIZE - nw) / 2) as i64,
    ((SIZE - nh) / 2) as i64,
  );

  let file = fs::File::create(output)?;
  let mut writer = BufWriter::new(file);
  let enc = webp::Encoder::from_rgba(canvas.as_raw(), SIZE, SIZE);
  let bytes = enc.encode(80.0);
  writer.write_all(&*bytes)?;
  Ok(())
}