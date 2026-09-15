// Relabels H.264 High@L5.x (what TikTok serves for 1080p60) down to L4.2 so
// WhatsApp's inline player accepts it. Pure byte patch — samples are never
// decoded, so a 45MB file is fixed in milliseconds with zero quality loss.
// 1080p60 fits L4.2 legitimately, so the new label is honest for typical
// TikTok files. Refuses HEVC / non-MP4 (exit 1, TS caller falls back).
use std::process::ExitCode;

const TARGET_LEVEL: u8 = 0x2A; // H.264 L4.2

fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  if args.len() != 2 {
    eprintln!("usage: video <input.mp4> <output.mp4>");
    return ExitCode::FAILURE;
  }
  let mut data = match std::fs::read(&args[0]) {
    Ok(d) => d,
    Err(e) => {
      eprintln!("video: {e}");
      return ExitCode::FAILURE;
    }
  };
  let n = match patch_level(&mut data) {
    Ok(n) => n,
    Err(e) => {
      eprintln!("video: {e}");
      return ExitCode::FAILURE;
    }
  };
  if let Err(e) = std::fs::write(&args[1], &data) {
    eprintln!("video: {e}");
    return ExitCode::FAILURE;
  }
  eprintln!(
    "video: {}",
    if n > 0 {
      format!("relabelled {n} track(s) to L4.2")
    } else {
      "already ok".to_string()
    }
  );
  ExitCode::SUCCESS
}

fn u32be(b: &[u8], i: usize) -> Option<u32> {
  b.get(i..i + 4)
    .and_then(|s| s.try_into().ok())
    .map(u32::from_be_bytes)
}

// top-level moov range (moov may sit before or after mdat)
fn find_moov(b: &[u8]) -> Option<(usize, usize)> {
  let mut i = 0;
  while i + 8 <= b.len() {
    let size = u32be(b, i)? as usize;
    let kind = b.get(i + 4..i + 8)?;
    if !kind.iter().all(|c| c.is_ascii_alphanumeric()) {
      break;
    }
    if size < 8 || i + size > b.len() {
      break;
    }
    if kind == b"moov" {
      return Some((i, i + size));
    }
    i += size;
  }
  None
}

fn find_all(b: &[u8], start: usize, end: usize, needle: &[u8; 4]) -> Vec<usize> {
  let mut out = Vec::new();
  let mut i = start;
  while i + 4 <= end && i + 4 <= b.len() {
    if &b[i..i + 4] == needle {
      out.push(i);
    }
    i += 1;
  }
  out
}

// is this tag occurrence a plausible box (sane size field right before it)?
fn is_box_at(b: &[u8], end: usize, t: usize) -> bool {
  if t < 4 {
    return false;
  }
  match u32be(b, t - 4) {
    Some(size) => (size as usize) >= 8 && t - 4 + (size as usize) <= end,
    None => false,
  }
}

// patch one avcC box at tag offset t; true if relabelled
fn patch_avcc(b: &mut [u8], moov_end: usize, t: usize) -> bool {
  let size = match u32be(b, t.saturating_sub(4)) {
    Some(s) if t >= 4 && (s as usize) >= 16 && t - 4 + (s as usize) <= moov_end => s as usize,
    _ => return false,
  };
  let box_end = t - 4 + size;
  let p = t + 4; // avcC has no version/flags
  let get = |i: usize| *b.get(i).unwrap_or(&0);
  if get(p) != 1 {
    return false; // not an AVCDecoderConfigurationRecord
  }
  // validate + collect SPS level positions before touching anything
  let num_sps = (get(p + 5) & 0x1F) as usize;
  let mut pos = p + 6;
  let mut sps_levels: Vec<usize> = Vec::new();
  for _ in 0..num_sps {
    let slen = match b.get(pos..pos + 2) {
      Some(s) => u16::from_be_bytes([s[0], s[1]]) as usize,
      None => return false,
    };
    let s = pos + 2;
    // SPS NAL: type 7, level_idc at index 3 (after NAL header)
    if slen < 4 || s + slen > box_end || (b[s] & 0x1F) != 7 {
      return false;
    }
    sps_levels.push(s + 3);
    pos = s + slen;
  }
  if pos + 1 > box_end {
    return false; // no room for PPS count
  }
  if get(p + 3) <= TARGET_LEVEL {
    return false; // already within limit
  }
  b[p + 3] = TARGET_LEVEL;
  for q in sps_levels {
    if b[q] > TARGET_LEVEL {
      b[q] = TARGET_LEVEL;
    }
  }
  true
}

fn patch_level(b: &mut Vec<u8>) -> Result<usize, String> {
  let (ms, me) = find_moov(b).ok_or("no moov box — not a regular MP4")?;
  for tag in [*b"hvc1", *b"hev1"] {
    if find_all(b, ms, me, &tag)
      .iter()
      .any(|&t| is_box_at(b, me, t))
    {
      return Err("HEVC video — relabel not possible".to_string());
    }
  }
  let mut n = 0;
  for t in find_all(b, ms, me, b"avcC") {
    if patch_avcc(b, me, t) {
      n += 1;
    }
  }
  Ok(n)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn avcc_box(level: u8, sps_level: u8) -> Vec<u8> {
    let sps = vec![0x67, 100, 0, sps_level, 0x11, 0x22];
    let mut payload = vec![1, 100, 0, level, 0xFF, 0xE1];
    payload.extend_from_slice(&(sps.len() as u16).to_be_bytes());
    payload.extend_from_slice(&sps);
    payload.extend_from_slice(&[1, 0, 0]); // 1 PPS, len 0
    let mut v = Vec::new();
    v.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
    v.extend_from_slice(b"avcC");
    v.extend_from_slice(&payload);
    v
  }

  fn boxed(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
    v.extend_from_slice(kind);
    v.extend_from_slice(payload);
    v
  }

  fn mp4_with(moov_payload: &[u8], extra: &[u8]) -> Vec<u8> {
    let mut v = Vec::new();
    v.extend_from_slice(&20u32.to_be_bytes());
    v.extend_from_slice(b"ftyp");
    v.extend_from_slice(b"mp42mp42iso2");
    v.extend_from_slice(&boxed(b"moov", moov_payload));
    v.extend_from_slice(extra);
    v
  }

  #[test]
  fn relabels_l52_to_l42() {
    let mut b = mp4_with(&avcc_box(0x34, 0x34), &[]);
    assert_eq!(patch_level(&mut b), Ok(1));
    let t = b.windows(4).position(|w| w == b"avcC").unwrap();
    assert_eq!(b[t + 7], 0x2A); // avcC level_idc
    assert_eq!(b[t + 15], 0x2A); // SPS level_idc
  }

  #[test]
  fn leaves_l40_alone() {
    let mut b = mp4_with(&avcc_box(0x28, 0x28), &[]);
    let before = b.clone();
    assert_eq!(patch_level(&mut b), Ok(0));
    assert_eq!(b, before);
  }

  #[test]
  fn refuses_hevc() {
    let mut b = mp4_with(&boxed(b"hvc1", &[0, 0, 0, 0]), &[]);
    assert!(patch_level(&mut b).is_err());
  }

  #[test]
  fn refuses_garbage() {
    let mut b = b"no boxes here".to_vec();
    assert!(patch_level(&mut b).is_err());
  }

  #[test]
  fn ignores_mdat_lookalikes() {
    // fake avcC-shaped bytes inside mdat must not be touched
    let mut fake = Vec::new();
    fake.extend_from_slice(&30u32.to_be_bytes());
    fake.extend_from_slice(b"avcC");
    fake.extend_from_slice(&[1, 100, 0, 0x34, 0xFF, 0xE1]);
    let mdat = boxed(b"mdat", &fake);
    let mut b = mp4_with(&avcc_box(0x28, 0x28), &mdat);
    let before = b.clone();
    assert_eq!(patch_level(&mut b), Ok(0));
    assert_eq!(b, before);
  }
}
