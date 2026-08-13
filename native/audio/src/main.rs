// Defragments an AAC fragmented-MP4 (what ytmp3.mobi serves as "mp3") into a
// standard M4A (ftyp + moov with full stbl + single mdat). Pure container
// remux — samples are copied byte-for-byte, no decode/encode. iOS WhatsApp
// refuses to play fragmented MP4 in audio messages; a normal M4A plays fine.
use std::process::ExitCode;

fn main() -> ExitCode {
  let args: Vec<String> = std::env::args().skip(1).collect();
  if args.len() != 2 {
    eprintln!("usage: audio <input.fmp4> <output.m4a>");
    return ExitCode::FAILURE;
  }
  let data = match std::fs::read(&args[0]) {
    Ok(d) => d,
    Err(e) => {
      eprintln!("audio: {e}");
      return ExitCode::FAILURE;
    }
  };
  let out = match remux(&data) {
    Ok(o) => o,
    Err(e) => {
      eprintln!("audio: {e}");
      return ExitCode::FAILURE;
    }
  };
  match std::fs::write(&args[1], &out) {
    Ok(()) => ExitCode::SUCCESS,
    Err(e) => {
      eprintln!("audio: {e}");
      ExitCode::FAILURE
    }
  }
}

#[derive(Clone, Copy)]
struct Box_ {
  start: usize, // header start
  data: usize,  // payload start
  end: usize,   // end (exclusive)
}

// direct children of a container region
fn children(b: &[u8], start: usize, end: usize) -> Vec<Box_> {
  let mut out = Vec::new();
  let mut i = start;
  while i + 8 <= end {
    let size32 = u32::from_be_bytes(b[i..i + 4].try_into().unwrap());
    let (hdr, size) = if size32 == 1 {
      if i + 16 > end {
        break;
      }
      (16, u64::from_be_bytes(b[i + 8..i + 16].try_into().unwrap()) as usize)
    } else if size32 == 0 {
      (8, end - i)
    } else {
      (8, size32 as usize)
    };
    if size < hdr || i + size > end {
      break;
    }
    out.push(Box_ { start: i, data: i + hdr, end: i + size });
    i += size;
  }
  out
}

fn find<'a>(all: &'a [Box_], b: &[u8], kind4: &[u8; 4]) -> Option<Box_> {
  all.iter().copied().find(|x| b[x.start + 4..x.start + 8] == *kind4)
}

// full-box helpers: version byte + flags
fn u32_at(b: &[u8], off: usize) -> u32 {
  u32::from_be_bytes(b[off..off + 4].try_into().unwrap())
}

fn u64_at(b: &[u8], off: usize) -> u64 {
  u64::from_be_bytes(b[off..off + 8].try_into().unwrap())
}

fn box_payload(kind4: &[u8; 4], payload: &[u8]) -> Vec<u8> {
  let mut out = Vec::with_capacity(8 + payload.len());
  out.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
  out.extend_from_slice(kind4);
  out.extend_from_slice(payload);
  out
}

struct Sample {
  bytes: Vec<u8>,
  duration: u32,
}

fn remux(data: &[u8]) -> Result<Vec<u8>, String> {
  if data.len() < 8 || &data[4..8] != b"ftyp" {
    return Err("not an MP4".into());
  }
  let top = children(data, 0, data.len());
  let moov = find(&top, data, b"moov").ok_or("no moov box")?;
  let moov_children = children(data, moov.data, moov.end);
  let mvhd = find(&moov_children, data, b"mvhd").ok_or("no mvhd")?;
  let mvhd_v = data[mvhd.data];
  let mvhd_dur_off = if mvhd_v == 1 { 24 } else { 16 };

  let mut trak: Option<Box_> = None;
  let mut trex: Option<Box_> = None;
  for m in &moov_children {
    let k = &data[m.start + 4..m.start + 8];
    if k == b"trak" && trak.is_none() {
      trak = Some(*m);
    } else if k == b"mvex" {
      if let Some(mv) = children(data, m.data, m.end).into_iter().find(|x| &data[x.start + 4..x.start + 8] == b"trex") {
        trex = Some(mv);
      }
    }
  }
  let trak = trak.ok_or("no trak")?;
  let tkhd = children(data, trak.data, trak.end)
    .into_iter()
    .find(|x| &data[x.start + 4..x.start + 8] == b"tkhd")
    .ok_or("no tkhd")?;
  let mdia = children(data, trak.data, trak.end)
    .into_iter()
    .find(|x| &data[x.start + 4..x.start + 8] == b"mdia")
    .ok_or("no mdia")?;
  let mdia_children = children(data, mdia.data, mdia.end);
  let mdhd = find(&mdia_children, data, b"mdhd").ok_or("no mdhd")?;
  let mdhd_v = data[mdhd.data];
  let mdhd_ts_off = if mdhd_v == 1 { 20 } else { 12 };
  let mdhd_dur_off = if mdhd_v == 1 { 24 } else { 16 };
  let _timescale = u32_at(data, mdhd.data + mdhd_ts_off);
  let minf = find(&mdia_children, data, b"minf").ok_or("no minf")?;
  let minf_children = children(data, minf.data, minf.end);
  let stbl = find(&minf_children, data, b"stbl").ok_or("no stbl")?;
  let stbl_children = children(data, stbl.data, stbl.end);
  let stsd = find(&stbl_children, data, b"stsd").ok_or("no stsd")?;
  if !data[stsd.data + 8..stsd.data + 16].windows(4).any(|w| w == b"mp4a") {
    return Err("no mp4a audio sample entry".into());
  }
  let hdlr = find(&mdia_children, data, b"hdlr").ok_or("no hdlr")?;
  let smhd = minf_children
    .iter()
    .copied()
    .find(|x| &data[x.start + 4..x.start + 8] == b"smhd" || &data[x.start + 4..x.start + 8] == b"vmhd")
    .ok_or("no media header")?;
  let dinf = find(&minf_children, data, b"dinf").ok_or("no dinf")?;

  // default per-fragment sample params from mvex/trex
  let mut def_dur = 0u32;
  let mut def_size = 0u32;
  if let Some(tx) = trex {
    // trex payload: version/flags(4) track_id(4) default_sample_description_index(4) dur(4) size(4) flags(4)
    def_dur = u32_at(data, tx.data + 16);
    def_size = u32_at(data, tx.data + 20);
  }

  // collect samples from moof/mdat pairs
  let mut samples: Vec<Sample> = Vec::new();
  for m in &top {
    let k = &data[m.start + 4..m.start + 8];
    if k != b"moof" {
      continue;
    }
    for traf in children(data, m.data, m.end)
      .into_iter()
      .filter(|x| &data[x.start + 4..x.start + 8] == b"traf")
    {
      let traf_children = children(data, traf.data, traf.end);
      let tfhd = find(&traf_children, data, b"tfhd").ok_or("no tfhd in traf")?;
      let flags = u32_at(data, tfhd.data) & 0x00ff_ffff;
      let mut off = tfhd.data + 8; // after fullbox header
      let base = if flags & 0x000001 != 0 {
        let b = u64_at(data, off);
        off += 8;
        b as usize
      } else {
        m.start // default-base-is-moof semantics: relative to the moof
      };
      if flags & 0x000002 != 0 {
        off += 4; // sample_description_index
      }
      let tdef_dur = if flags & 0x000008 != 0 { let v = u32_at(data, off); off += 4; v } else { 0 };
      let tdef_size = if flags & 0x000010 != 0 { u32_at(data, off) } else { 0 };
      let tdef_dur = if tdef_dur == 0 { def_dur } else { tdef_dur };
      let tdef_size = if tdef_size == 0 { def_size } else { tdef_size };
      for trun in traf_children
        .into_iter()
        .filter(|x| &data[x.start + 4..x.start + 8] == b"trun")
      {
        let tflags = u32_at(data, trun.data) & 0x00ff_ffff;
        let n = u32_at(data, trun.data + 4) as usize;
        let mut p = trun.data + 8;
        let data_off = if tflags & 0x000001 != 0 {
          let v = i32::from_be_bytes(data[p..p + 4].try_into().unwrap());
          p += 4;
          base as i64 + v as i64
        } else {
          base as i64
        };
        if tflags & 0x000004 != 0 {
          p += 4; // first_sample_flags
        }
        let mut durs = Vec::with_capacity(n);
        let mut sizes = Vec::with_capacity(n);
        for _ in 0..n {
          durs.push(if tflags & 0x000100 != 0 { let v = u32_at(data, p); p += 4; v } else { tdef_dur });
          sizes.push(if tflags & 0x000200 != 0 { let v = u32_at(data, p); p += 4; v } else { tdef_size });
          if tflags & 0x000400 != 0 {
            p += 4;
          }
          if tflags & 0x000800 != 0 {
            p += 4;
          }
        }
        let mut cursor = data_off;
        for (i, &sz) in sizes.iter().enumerate() {
          let sz = sz as usize;
          if cursor < 0 || (cursor as usize) + sz > data.len() || sz == 0 {
            return Err(format!("bad sample range at offset {cursor} (size {sz})"));
          }
          let bytes = data[cursor as usize..(cursor as usize) + sz].to_vec();
          cursor += sz as i64;
          samples.push(Sample { bytes, duration: durs[i] });
        }
      }
    }
  }
  if samples.is_empty() {
    return Err("no audio samples found".into());
  }

  // total media duration in media timescale units
  let total_ts_u64: u64 = samples.iter().map(|s| s.duration as u64).sum();

  // --- build a fresh moov ---------------------------------------------------
  let mvhd = patch_duration(data, mvhd, mvhd_dur_off, mvhd_v, total_ts_u64);
  let tkhd_b = patch_duration(data, tkhd, if data[tkhd.data] == 1 { 24 } else { 16 }, data[tkhd.data], total_ts_u64);
  let mdhd_b = patch_duration(data, mdhd, mdhd_dur_off, mdhd_v, total_ts_u64);

  // stts / stsc / stsz / stco from the collected samples
  let stts = build_stts(&samples);
  let stsc = {
    let mut p = Vec::with_capacity(16);
    p.extend_from_slice(&0u32.to_be_bytes()); // version/flags
    p.extend_from_slice(&1u32.to_be_bytes()); // entry_count
    p.extend_from_slice(&1u32.to_be_bytes()); // first_chunk
    p.extend_from_slice(&(samples.len() as u32).to_be_bytes()); // samples_per_chunk
    p.extend_from_slice(&1u32.to_be_bytes()); // sample_description_index
    box_payload(b"stsc", &p)
  };
  let mut stsz_p = Vec::with_capacity(12 + samples.len() * 4);
  stsz_p.extend_from_slice(&0u32.to_be_bytes());
  stsz_p.extend_from_slice(&0u32.to_be_bytes()); // sample_size = 0 (varying)
  stsz_p.extend_from_slice(&(samples.len() as u32).to_be_bytes());
  for s in &samples {
    stsz_p.extend_from_slice(&(s.bytes.len() as u32).to_be_bytes());
  }
  let stsz = box_payload(b"stsz", &stsz_p);
  // stco value is patched after the mdat offset is known
  let mut stco_p = Vec::with_capacity(16);
  stco_p.extend_from_slice(&0u32.to_be_bytes());
  stco_p.extend_from_slice(&1u32.to_be_bytes());
  stco_p.extend_from_slice(&0u32.to_be_bytes()); // placeholder
  let stco = box_payload(b"stco", &stco_p);

  let stsd_b = data[stsd.start..stsd.end].to_vec();
  let stbl = box_payload(b"stbl", &[&stsd_b[..], &stts[..], &stsc[..], &stsz[..], &stco[..]].concat());
  let minf = box_payload(b"minf", &[&data[smhd.start..smhd.end][..], &data[dinf.start..dinf.end][..], &stbl[..]].concat());
  let hdlr_b = data[hdlr.start..hdlr.end].to_vec();
  let mdia = box_payload(b"mdia", &[&mdhd_b[..], &hdlr_b[..], &minf[..]].concat());
  let trak = box_payload(b"trak", &[&tkhd_b[..], &mdia[..]].concat());
  let mut moov = box_payload(b"moov", &[&mvhd[..], &trak[..]].concat());

  // --- assemble ------------------------------------------------------------
  let mut ftyp_p = Vec::with_capacity(20);
  ftyp_p.extend_from_slice(b"M4A "); // major_brand
  ftyp_p.extend_from_slice(&0u32.to_be_bytes()); // minor_version
  ftyp_p.extend_from_slice(b"M4A isommp42"); // compatible brands
  let ftyp = box_payload(b"ftyp", &ftyp_p);

  let mdat_data: Vec<u8> = samples.iter().flat_map(|s| s.bytes.iter().copied()).collect();
  let mdat_off = ftyp.len() + moov.len() + 8;

  // patch the stco offset — layout: size(4) 'stco'(4) fullbox(4) entry_count(4) offset(4)
  let stco_at = moov
    .windows(4)
    .position(|w| w == b"stco")
    .ok_or("stco not found in rebuilt moov")?;
  let stco_field = stco_at + 4 + 4 + 4; // past 'stco' + fullbox + entry_count
  moov[stco_field..stco_field + 4].copy_from_slice(&(mdat_off as u32).to_be_bytes());

  let mut out = Vec::with_capacity(mdat_off + mdat_data.len());
  out.extend_from_slice(&ftyp);
  out.extend_from_slice(&moov);
  out.extend_from_slice(&((8 + mdat_data.len()) as u32).to_be_bytes());
  out.extend_from_slice(b"mdat");
  out.extend_from_slice(&mdat_data);

  Ok(out)
}

fn patch_duration(b: &[u8], bx: Box_, dur_off: usize, version: u8, dur: u64) -> Vec<u8> {
  let mut out = b[bx.start..bx.end].to_vec();
  let rel = bx.data + dur_off - bx.start;
  if version == 1 {
    out[rel..rel + 8].copy_from_slice(&dur.to_be_bytes());
  } else {
    out[rel..rel + 4].copy_from_slice(&(dur as u32).to_be_bytes());
  }
  out
}

// time-to-sample: consecutive runs of equal durations
fn build_stts(samples: &[Sample]) -> Vec<u8> {
  let mut runs: Vec<(u32, u32)> = Vec::new();
  for s in samples {
    match runs.last_mut() {
      Some((count, dur)) if *dur == s.duration => *count += 1,
      _ => runs.push((1, s.duration)),
    }
  }
  let mut p = Vec::with_capacity(8 + runs.len() * 8);
  p.extend_from_slice(&0u32.to_be_bytes());
  p.extend_from_slice(&(runs.len() as u32).to_be_bytes());
  for (c, d) in runs {
    p.extend_from_slice(&c.to_be_bytes());
    p.extend_from_slice(&d.to_be_bytes());
  }
  box_payload(b"stts", &p)
}
