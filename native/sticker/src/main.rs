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
  if args.len() != 2 {
    eprintln!("usage: sticker <input> <output>");
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
    Ok(()) => ExitCode::SUCCESS,
    Err(e) => {
      eprintln!("sticker: {e}");
      ExitCode::FAILURE
    }
  }
}

fn is_mp4(data: &[u8]) -> bool {
  data.len() >= 12 && &data[4..8] == b"ftyp"
}

fn convert_image(data: &[u8], output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let img = image::load_from_memory(data)?;
  let (w, h) = img.dimensions();
  let scale = SIZE as f32 / w.max(h) as f32;
  let (nw, nh) = if scale < 1.0 {
    (
      ((w as f32 * scale) as u32).max(1),
      ((h as f32 * scale) as u32).max(1),
    )
  } else {
    (w, h)
  };
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