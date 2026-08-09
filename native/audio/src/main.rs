// Usage: audio2mp3 <input.m4a> <output.mp3>
use std::env;
use std::fs;
use std::process::ExitCode;

use rusty_mp3::{Error as Mp3Error, Mp3Encoder, Mp3EncoderConfig};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SErr;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

fn main() -> ExitCode {
  let args: Vec<String> = env::args().skip(1).collect();
  if args.len() == 1 && args[0] == "--selftest" {
    return match selftest() {
      Ok(()) => ExitCode::SUCCESS,
      Err(e) => {
        eprintln!("audio2mp3: {e}");
        ExitCode::FAILURE
      }
    };
  }
  if args.len() != 2 {
    eprintln!("usage: audio2mp3 <input.m4a> <output.mp3>");
    return ExitCode::FAILURE;
  }
  match convert(&args[0], &args[1]) {
    Ok(()) => ExitCode::SUCCESS,
    Err(e) => {
      eprintln!("audio2mp3: {e}");
      ExitCode::FAILURE
    }
  }
}

fn convert(input: &str, output: &str) -> Result<(), Box<dyn std::error::Error>> {
  let file = fs::File::open(input)?;
  let mss = MediaSourceStream::new(Box::new(file), Default::default());

  let mut hint = Hint::new();
  if let Some(ext) = std::path::Path::new(input).extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }
  let probed = symphonia::default::get_probe().format(
    &hint,
    mss,
    &FormatOptions::default(),
    &MetadataOptions::default(),
  )?;
  let mut format = probed.format;

  let track = format
    .tracks()
    .iter()
    .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    .ok_or("no audio track found")?;
  let track_id = track.id;
  let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
  let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2) as u16;
  if channels > 2 {
    return Err(format!("unsupported channel count: {channels}").into());
  }
  let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default())?;

  let mut enc = Mp3Encoder::new(Mp3EncoderConfig::default());
  let mut sample_buf: Option<SampleBuffer<i16>> = None;

  loop {
    let packet = match format.next_packet() {
      Ok(p) => p,
      Err(SErr::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
      Err(e) => return Err(e.into()),
    };
    if packet.track_id() != track_id {
      continue;
    }
    let decoded = match decoder.decode(&packet) {
      Ok(d) => d,
      Err(SErr::DecodeError(_)) | Err(SErr::IoError(_)) => continue,
      Err(e) => return Err(e.into()),
    };
    let spec = *decoded.spec();
    let buf = sample_buf.get_or_insert_with(|| SampleBuffer::<i16>::new(decoded.capacity() as u64, spec));
    buf.copy_interleaved_ref(decoded);
    enc.push_pcm_s16(buf.samples(), channels, sample_rate)?;
  }

  enc.finish();

  let mut out = Vec::new();
  loop {
    match enc.next_packet() {
      Ok(pkt) => out.extend_from_slice(&pkt),
      Err(Mp3Error::Eof) => break,
      Err(e) => return Err(format!("encode error: {e:?}").into()),
    }
  }
  if out.is_empty() {
    return Err("no decodable audio".into());
  }
  fs::write(output, out)?;
  Ok(())
}

fn selftest() -> Result<(), Box<dyn std::error::Error>> {
  let sample_rate = 44100u32;
  let channels: u16 = 2;
  let mut enc = Mp3Encoder::new(Mp3EncoderConfig::default());
  let mut pcm = Vec::with_capacity(sample_rate as usize * 2);
  for i in 0..sample_rate as usize {
    let v = (i as f32 * 440.0 * 2.0 * std::f32::consts::PI / sample_rate as f32).sin();
    let s = (v * i16::MAX as f32) as i16;
    pcm.push(s);
    pcm.push(s);
  }
  enc.push_pcm_s16(&pcm, channels, sample_rate)?;
  enc.finish();
  let mut out = Vec::new();
  loop {
    match enc.next_packet() {
      Ok(pkt) => out.extend_from_slice(&pkt),
      Err(Mp3Error::Eof) => break,
      Err(e) => return Err(format!("encode error: {e:?}").into()),
    }
  }
  if out.len() < 1000 || out[0] != 0xFF {
    return Err("selftest: encoded output looks wrong".into());
  }
  println!("selftest ok: {} bytes of mp3", out.len());
  Ok(())
}
