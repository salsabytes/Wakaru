// Sound-sticker audio: anything we can decode -> a short Ogg Opus clip.
//
// WhatsApp sound stickers keep their audio as a plain AudioMessage embedded in
// the sticker, and its client only plays `audio/ogg; codecs=opus`. ffmpeg is
// not allowed here (zero external services), so decoding is symphonia and
// encoding is opus-pure — both pure Rust, no DLLs.
//
// Opus only accepts 8/12/16/24/48 kHz, so everything is resampled to 48 kHz
// (rubato) before encoding, and downmixed to at most stereo (the sticker
// format carries no more than that).
//
// Two input families are handled:
//   - `OggS` + `OpusHead`: a WhatsApp voice note, decoded by opus-pure directly
//     (symphonia has no Opus decoder).
//   - everything else (m4a/aac, mp3, wav, flac, mp4 video): symphonia.
use opus_pure::ogg::{OggOpusReader, OggOpusWriter, OpusHead};
use opus_pure::{Application, OpusDecoder, OpusEncoder};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

const OUT_RATE: usize = 48_000;
const FRAME: usize = 960; // 20 ms at 48 kHz

pub struct Encoded {
  pub frames: usize,
  pub channels: usize,
  pub bitrate: usize,
}

/// `soundsticker <input> <output.ogg> <max_seconds>`
pub fn run(input: &Path, output: &Path, max_secs: f32) -> Result<Encoded, String> {
  let mut file = File::open(input).map_err(|e| format!("{}: {e}", input.display()))?;
  let ogg_opus = detect_ogg_opus(&mut file)?;
  file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;

  let frame_cap = (max_secs.max(0.2) * OUT_RATE as f32) as usize;

  let (pcm, rate, channels) = if ogg_opus {
    decode_ogg_opus(file, frame_cap)?
  } else {
    decode_with_symphonia(input, frame_cap)?
  };
  if pcm.is_empty() {
    return Err("no audio decoded".into());
  }

  let pcm = if rate != OUT_RATE {
    resample(&pcm, rate, channels)?
  } else {
    pcm
  };
  let frames = (pcm.len() / channels).min(frame_cap);

  let bitrate = if channels == 1 { 24_000 } else { 32_000 };
  let mut enc = OpusEncoder::new(OUT_RATE as i32, channels, Application::Audio)
    .map_err(|e| format!("opus encoder: {e}"))?;
  enc.bitrate_bps = bitrate;

  let head =
    OpusHead::new(channels as u8, OUT_RATE as u32).map_err(|e| format!("opus head: {e}"))?;
  let sink = File::create(output).map_err(|e| format!("{}: {e}", output.display()))?;
  let mut writer = OggOpusWriter::new(sink, head).map_err(|e| format!("ogg writer: {e}"))?;

  let mut packet = vec![0u8; 4000];
  let mut encoded = 0usize;
  while encoded + FRAME <= frames {
    let at = encoded * channels;
    let n = enc
      .encode(&pcm[at..at + FRAME * channels], FRAME, &mut packet)
      .map_err(|e| format!("opus encode: {e}"))?;
    writer
      .write_packet(&packet[..n])
      .map_err(|e| format!("ogg write: {e}"))?;
    encoded += FRAME;
  }
  // A tail shorter than one frame is padded rather than dropped, so a 0.3 s
  // clip does not come out silent.
  if encoded < frames {
    let mut tail = vec![0f32; FRAME * channels];
    let have = frames - encoded;
    let at = encoded * channels;
    tail[..have * channels].copy_from_slice(&pcm[at..at + have * channels]);
    let n = enc
      .encode(&tail, FRAME, &mut packet)
      .map_err(|e| format!("opus encode: {e}"))?;
    writer
      .write_packet(&packet[..n])
      .map_err(|e| format!("ogg write: {e}"))?;
    encoded = frames;
  }
  writer.finish().map_err(|e| format!("ogg finish: {e}"))?;

  Ok(Encoded { frames: encoded, channels: channels as usize, bitrate: bitrate as usize })
  }

// A 4-byte suffix scan is enough: "OggS" at 0 is guaranteed by the container
// spec, and a raw Opus stream without it is not something WhatsApp produces.
fn detect_ogg_opus(file: &mut File) -> Result<bool, String> {
  let mut head = [0u8; 4];
  let n = file.read(&mut head).map_err(|e| e.to_string())?;
  if n < 4 || &head != b"OggS" {
    return Ok(false);
  }
  let mut probe = [0u8; 64];
  let n = file.read(&mut probe).map_err(|e| e.to_string())?;
  Ok(probe[..n].windows(8).any(|w| w == b"OpusHead"))
}

fn decode_ogg_opus(file: File, cap: usize) -> Result<(Vec<f32>, usize, usize), String> {
  let mut reader =
    OggOpusReader::new(BufReader::new(file)).map_err(|e| format!("ogg reader: {e}"))?;
  let head = reader.head().clone();
  let channels = head.channel_count as usize;
  if channels == 0 || channels > 2 {
    return Err(format!("unsupported channel count {channels}"));
  }
  let mut decoder = OpusDecoder::new(OUT_RATE as i32, channels)
    .map_err(|e| format!("opus decoder: {e}"))?;
  let mut pcm: Vec<f32> = Vec::new();
  let mut scratch = vec![0f32; 5760 * channels];
  while pcm.len() / channels < cap {
    let packet = match reader.read_packet() {
      Ok(Some(p)) => p,
      Ok(None) => break,
      Err(e) => return Err(format!("ogg read: {e}")),
    };
    let got = decoder
      .decode(&packet.data, 5760, &mut scratch)
      .map_err(|e| format!("opus decode: {e}"))?;
    pcm.extend_from_slice(&scratch[..got * channels]);
  }
  Ok((pcm, OUT_RATE, channels))
}

fn decode_with_symphonia(
  input: &Path,
  cap: usize,
) -> Result<(Vec<f32>, usize, usize), String> {
  let file = File::open(input).map_err(|e| format!("{}: {e}", input.display()))?;
  let mss = MediaSourceStream::new(Box::new(file), Default::default());
  let mut hint = Hint::new();
  if let Some(ext) = input.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }
  let mut format = symphonia::default::get_probe()
    .probe(
      &hint,
      mss,
      FormatOptions::default(),
      MetadataOptions::default(),
    )
    .map_err(|e| format!("probe: {e}"))?;

  let track = format
    .default_track(TrackType::Audio)
    .ok_or("no audio track")?
    .clone();
  let track_id = track.id;
  let params = track
    .codec_params
    .as_ref()
    .ok_or("no codec parameters")?
    .audio()
    .ok_or("not an audio track")?
    .clone();
  let rate = params.sample_rate.ok_or("unknown sample rate")? as usize;
  let channels = params.channels.as_ref().map(|c| c.count()).unwrap_or(1);
  if channels == 0 {
    return Err("unknown channel layout".into());
  }
  let mut decoder = symphonia::default::get_codecs()
    .make_audio_decoder(&params, &AudioDecoderOptions::default())
    .map_err(|e| format!("decoder: {e}"))?;

  // Cap *before* resampling so a 15-minute mp3 is not decoded in full.
  let cap_frames = cap * rate / OUT_RATE;
  let mut pcm: Vec<f32> = Vec::new();
  let mut planar: Vec<f32> = Vec::new();
  loop {
    if pcm.len() / channels >= cap_frames {
      break;
    }
    let packet = match format.next_packet() {
      Ok(Some(p)) => p,
      Ok(None) => break,
      Err(SymphoniaError::IoError(_)) => break,
      Err(SymphoniaError::ResetRequired) => break,
      Err(e) => return Err(format!("read: {e}")),
    };
    if packet.track_id != track_id {
      continue;
    }
    match decoder.decode(&packet) {
      Ok(buf) => {
        planar.resize(buf.samples_interleaved(), 0.0);
        buf.copy_to_slice_interleaved(&mut planar);
        // >2 channels: keep the first two rather than mixing, which would need
        // the channel layout to be right (sticker audio is mono/stereo anyway).
        if channels <= 2 {
          pcm.extend_from_slice(&planar);
        } else {
          let frames = buf.frames();
          for f in 0..frames {
            pcm.push(planar[f * channels]);
            pcm.push(planar[f * channels + 1]);
          }
        }
      }
      Err(SymphoniaError::DecodeError(_)) => continue,
      Err(SymphoniaError::IoError(_)) => break,
      Err(e) => return Err(format!("decode: {e}")),
    }
  }
  let channels = channels.min(2);
  Ok((pcm, rate, channels))
}

// band-limited resample to OUT_RATE; a naive linear pass would alias badly on
// 44.1 kHz music, which is exactly what users send.
fn resample(pcm: &[f32], from: usize, channels: usize) -> Result<Vec<f32>, String> {
  use rubato::{FftFixedInOut, Resampler};
  let mut r = FftFixedInOut::<f32>::new(from, OUT_RATE, 1024, channels)
    .map_err(|e| format!("resampler: {e}"))?;
  let in_frames = pcm.len() / channels;
  let chunk = r.input_frames_next();
  let mut out: Vec<f32> = Vec::with_capacity(in_frames * OUT_RATE / from + chunk * channels);
  let mut planes: Vec<Vec<f32>> = vec![Vec::with_capacity(chunk); channels];

  let mut pos = 0usize;
  while pos + chunk <= in_frames {
    for (c, plane) in planes.iter_mut().enumerate() {
      plane.clear();
      for i in 0..chunk {
        plane.push(pcm[(pos + i) * channels + c]);
      }
    }
    let res = r.process(&planes, None).map_err(|e| format!("resample: {e}"))?;
    let got = res[0].len();
    for i in 0..got {
      for p in res.iter() {
        out.push(p[i]);
      }
    }
    pos += chunk;
  }
  if pos < in_frames {
    let rem = in_frames - pos;
    for (c, plane) in planes.iter_mut().enumerate() {
      plane.clear();
      for i in 0..chunk {
        let idx = if i < rem { (pos + i) * channels + c } else { usize::MAX };
        plane.push(if idx == usize::MAX { 0.0 } else { pcm[idx] });
      }
    }
    let res = r.process(&planes, None).map_err(|e| format!("resample: {e}"))?;
    let keep = (rem * OUT_RATE).div_ceil(from).min(res[0].len());
    for i in 0..keep {
      for p in res.iter() {
        out.push(p[i]);
      }
    }
  }
  Ok(out)
}

/// Resolve the `soundsticker` subcommand's 3 arguments.
pub fn parse_args(args: &[String]) -> Result<(PathBuf, PathBuf, f32), String> {
  if args.len() < 3 || args.len() > 4 {
    return Err("usage: audio soundsticker <in> <out.ogg> [max_seconds]".into());
  }
  let max = match args.get(3) {
    Some(s) => s.parse::<f32>().map_err(|_| "max_seconds must be a number")?,
    None => 10.0,
  };
  Ok((PathBuf::from(&args[1]), PathBuf::from(&args[2]), max))
}
