mod video;

use std::env;
use std::fs;
use std::io::{BufWriter, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::process::ExitCode;

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, Rgba, RgbaImage};

const SIZE: u32 = 512;
const DIM: u32 = 350;

fn main() -> ExitCode {
  let args: Vec<String> = env::args().skip(1).collect();
  if args.first().is_some_and(|a| a == "timg") {
    if args.len() != 3 {
      eprintln!("usage: sticker timg <input.webp> <output.png>");
      return ExitCode::FAILURE;
    }
    return match webp_to_png(&args[1], &args[2]) {
      Ok(()) => ExitCode::SUCCESS,
      Err(e) => {
        eprintln!("timg: {e}");
        ExitCode::FAILURE
      }
    };
  }
  if args.first().is_some_and(|a| a == "brat") {
    if args.len() != 3 {
      eprintln!("usage: sticker brat <text> <output.webp>");
      return ExitCode::FAILURE;
    }
    return match brat_to_sticker(&args[1], &args[2]) {
      Ok(()) => ExitCode::SUCCESS,
      Err(e) => {
        eprintln!("brat: {e}");
        ExitCode::FAILURE
      }
    };
  }
  if args.first().is_some_and(|a| a == "hd") {
    if args.len() != 3 {
      eprintln!("usage: sticker hd <input> <output.png>");
      return ExitCode::FAILURE;
    }
    return match hd_upscale(&args[1], &args[2]) {
      Ok(()) => ExitCode::SUCCESS,
      Err(e) => {
        eprintln!("hd: {e}");
        ExitCode::FAILURE
      }
    };
  }
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

// WhatsApp sticker pack/author lives in a custom EXIF tag (0x5741):
// 22-byte TIFF header + JSON payload, length at byte 14 (LE).
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

// EXIF chunk must come after image data, with the VP8X EXIF flag set.
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
    i = start + size + (size & 1);
  }
  if chunks.is_empty() {
    return Err("no webp chunks found".into());
  }

  let mut out = Vec::with_capacity(webp.len() + exif.len() + 64);
  out.extend_from_slice(b"RIFF");
  out.extend_from_slice(&[0u8; 4]);
  out.extend_from_slice(b"WEBP");

  let mut rest = chunks.into_iter();
  if let Some((fourcc, mut data)) = rest.next() {
    if fourcc == b"VP8X" {
      if !data.is_empty() {
        data[0] |= 0x08;
      }
      push_chunk(&mut out, &fourcc, &data);
    } else {
      let mut vp8x = vec![0u8; 10];
      vp8x[0] = 0x08;
      let d = (SIZE - 1).to_le_bytes();
      vp8x[4..7].copy_from_slice(&d[..3]);
      vp8x[7..10].copy_from_slice(&d[..3]);
      push_chunk(&mut out, b"VP8X", &vp8x);
      push_chunk(&mut out, &fourcc, &data);
    }
  }
  // image/data chunks keep original order
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
    assert_eq!(cs[0].1[0] & 0x08, 0x08);
    assert_eq!(cs[0].1[4..7], [0xff, 0x01, 0x00]);
    assert_eq!(cs[1].0, b"VP8 ");
    assert_eq!(cs[1].1, [1, 2, 3]);
    assert_eq!(cs[2].0, b"EXIF");
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
    assert_eq!(cs[0].1[0], 0x18);
    assert_eq!(cs[1].0, b"VP8 ");
    assert_eq!(cs[2].0, b"EXIF");
  }
}

fn is_mp4(data: &[u8]) -> bool {
  data.len() >= 12 && &data[4..8] == b"ftyp"
}

// sticker (webp) -> png, animated takes frame 0 only
fn webp_to_png(input: &str, output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let data = fs::read(input)?;
  let anim = webp::AnimDecoder::new(&data).decode().ok();
  let img: DynamicImage = match anim.as_ref().and_then(|a| a.get_frame(0)) {
    Some(frame) => DynamicImage::from(&frame),
    None => webp::Decoder::new(&data).decode().map(|w| w.to_image()).ok_or("not a webp")?,
  };
  img.save(output)?;
  Ok(())
}

fn brat_to_sticker(text: &str, output: &str) -> Result<(), Box<dyn std::error::Error>> {
  use ab_glyph::{Font, FontRef, PxScale, PxScaleFont, ScaleFont};
  let font = FontRef::try_from_slice(include_bytes!("../assets/brat.ttf"))?;
  let text: String = text
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
    .chars()
    .filter(|&c| c == ' ' || font.glyph_id(c).0 != 0)
    .take(300)
    .collect();
  if text.trim().is_empty() {
    return Err("empty text".into());
  }
  let rd = 1000u32;
  let r = rd as f32 / 500.0;
  let pad = rd as f32 * 0.04;
  let max_w = rd as f32 - pad * 2.0;
  let max_h = rd as f32 - pad * 2.0;
  let upm = font.units_per_em().unwrap_or(2048.0);
  let em_fix = font.height_unscaled() / upm;
  let px = |size: f32| PxScale::from(size * em_fix);
  let words: Vec<&str> = text.split(' ').collect();
  let layout = |scale: PxScale| -> Option<Vec<(f32, String)>> {
    let sf = font.as_scaled(scale);
    let space = sf.h_advance(sf.glyph_id(' '));
    let mut lines: Vec<(f32, String)> = Vec::new();
    let mut cur = String::new();
    let mut cur_w = 0.0f32;
    for w in &words {
      let mut ww = 0.0f32;
      let mut prev = None;
      for c in w.chars() {
        let id = sf.glyph_id(c);
        if let Some(p) = prev {
          ww += sf.kern(p, id);
        }
        ww += sf.h_advance(id);
        prev = Some(id);
      }
      let add = if cur.is_empty() { ww } else { space + ww };
      if cur_w + add > max_w && !cur.is_empty() {
        lines.push((cur_w, std::mem::take(&mut cur)));
        cur_w = 0.0;
      }
      if !cur.is_empty() {
        cur.push(' ');
        cur_w += space;
      }
      cur.push_str(w);
      cur_w += ww;
    }
    if !cur.is_empty() {
      lines.push((cur_w, cur));
    }
    if lines.is_empty() || (lines.len() as f32) * scale.y / em_fix > max_h {
      return None;
    }
    if lines.iter().any(|(w, _)| *w > max_w) {
      return None;
    }
    Some(lines)
  };
  let mut size = 170.0 * r;
  let floor = 20.0 * r;
  while size > floor && layout(px(size)).is_none() {
    size -= 4.0 * r;
  }
  let scale = px(size.max(floor));
  let (lines, _) = match layout(scale) {
    Some(lines) => (lines, scale),
    None => (vec![(0.0, text.clone())], scale),
  };
  let sf = font.as_scaled(scale);
  let lh = scale.y / em_fix;
  let mut y = pad + sf.ascent() - size * 0.094;

  let mut canvas = RgbaImage::from_pixel(rd, rd, Rgba([255, 255, 255, 255]));
  let draw_line = |canvas: &mut RgbaImage, sf: &PxScaleFont<&FontRef>, line: &str, line_w: f32, y: f32| {
    let gaps = line.split(' ').count().saturating_sub(1);
    let step = if gaps > 0 { (max_w - line_w) / gaps as f32 } else { 0.0 };
    let mut x = pad;
    let mut prev = None;
    for c in line.chars() {
      if c == ' ' {
        x += sf.h_advance(sf.glyph_id(' ')) + step;
        prev = None;
        continue;
      }
      let id = sf.glyph_id(c);
      if let Some(p) = prev {
        x += sf.kern(p, id);
      }
      let g = id.with_scale_and_position(scale, ab_glyph::point(x, y));
      if let Some(o) = sf.outline_glyph(g) {
        let bx = o.px_bounds().min.x as i32;
        let by = o.px_bounds().min.y as i32;
        o.draw(|gx, gy, v| {
          let px = bx + gx as i32;
          let py = by + gy as i32;
          if px >= 0 && py >= 0 && px < rd as i32 && py < rd as i32 {
            let p = canvas.get_pixel_mut(px as u32, py as u32);
            let v = v.clamp(0.0, 1.0);
            let keep = p[0] as f32 / 255.0 * (1.0 - v);
            let c = (keep * 255.0) as u8;
            p[0] = c;
            p[1] = c;
            p[2] = c;
            p[3] = 255;
          }
        });
      }
      x += sf.h_advance(id);
      prev = Some(id);
    }
  };
  for (w, line) in &lines {
    draw_line(&mut canvas, &sf, line, *w, y);
    y += lh;
  }

  let blurred = image::imageops::blur(&canvas, 2.2 * r);
  let sharp = image::imageops::resize(&blurred, DIM, DIM, image::imageops::FilterType::Lanczos3);
  let file = fs::File::create(output)?;
  let mut writer = BufWriter::new(file);
  let enc = webp::Encoder::from_rgba(sharp.as_raw(), DIM, DIM);
  let bytes = enc.encode(90.0);
  writer.write_all(&bytes)?;
  Ok(())
}

fn brat_to_webp(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let img = image::load_from_memory(data)?;
  let (w, h) = img.dimensions();
  assert_eq!((w, h), (DIM, DIM));
  let rgba = img.to_rgba8();
  let file = fs::File::create(output)?;
  let mut writer = BufWriter::new(file);
  let enc = webp::Encoder::from_rgba(rgba.as_raw(), DIM, DIM);
  let bytes = enc.encode(80.0);
  writer.write_all(&*bytes)?;
  Ok(())
}

fn hd_upscale(input: &str, output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let img = image::load_from_memory(&fs::read(input)?)?.to_rgb8();
  let (w, h) = (img.width(), img.height());
  let scale = (2048.0 / w.max(h) as f32).min(2.0);
  let (nw, nh) = ((w as f32 * scale) as u32, (h as f32 * scale) as u32);
  let big = image::imageops::resize(&img, nw.max(1), nh.max(1), FilterType::Lanczos3);
  let sharp = image::imageops::unsharpen(&big, 1.0, 80);
  sharp.save(output)?;
  Ok(())
}

fn convert_image(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let img = image::load_from_memory(data)?;
  let (w, h) = img.dimensions();
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