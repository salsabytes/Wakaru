import { UA } from './http.ts'
import { download } from './ytmp3.ts'
import { searchYouTube } from './youtube.ts'

// Spotify is DRM — the full track can't be scraped. We read public metadata (title +
// artist) from the embed page, then find the same song on YouTube and download that.
const idOf = (rawUrl: string, kind: 'track' | 'album'): string | undefined =>
  rawUrl.match(new RegExp(`open\\.spotify\\.com\\/${kind}\\/([A-Za-z0-9]{22})`))?.[1]

export type SpotifyMeta =
  | { kind: 'track'; title: string; artist: string }
  | { kind: 'album'; title: string; artist: string; tracks: { title: string; artist: string }[] }

export async function spotifyMeta(rawUrl: string): Promise<SpotifyMeta> {
  const trackId = idOf(rawUrl, 'track')
  const albumId = idOf(rawUrl, 'album')
  if (!trackId && !albumId) throw new Error('spotify: not a Spotify link (track or album)')
  const res = await fetch(`https://open.spotify.com/embed/${trackId ? 'track' : 'album'}/${trackId ?? albumId}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`spotify: embed http ${res.status}`)
  const html = await res.text()
  const blob = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
  let json: any
  try {
    json = blob ? JSON.parse(blob) : null
  } catch {
    json = null
  }
  const walk = (o: any, out: any[] = []): any[] => {
    if (!o || typeof o !== 'object') return out
    if (typeof o.name === 'string' && o.uri?.includes(trackId ? 'track' : 'album')) out.push(o)
    for (const v of Object.values(o)) walk(v, out)
    return out
  }
  const entity = json ? walk(json)[0] : undefined
  if (trackId) {
    const title = entity?.title || entity?.name
    const artist = entity?.artists?.[0]?.name
    if (!title || !artist) throw new Error('spotify: track metadata not found')
    return { kind: 'track', title, artist }
  }
  // album: entity.trackList has per-track title + artist (subtitle)
  const title = entity?.title || entity?.name
  const artist = entity?.subtitle || entity?.artists?.[0]?.name
  const tracks = (entity?.trackList ?? [])
    .filter((t: any) => t?.title)
    .map((t: any) => ({ title: t.title, artist: t.subtitle || artist || '' }))
  if (!title || !tracks.length) throw new Error('spotify: album metadata not found')
  return { kind: 'album', title, artist: artist || '', tracks }
}

const trackAudio = async (title: string, artist: string): Promise<Buffer> => {
  // quoted title — the exact song, not a cover/remix of the same name
  const results = await searchYouTube(`"${title}" ${artist}`)
  const first = results[0]
  if (!first) throw new Error(`spotify: no YouTube match for "${title}"`)
  const got = await download(`https://youtu.be/${first.id}`, 'audio')
  return got.buf
}

export async function downloadSpotify(rawUrl: string): Promise<{ media: { type: 'audio'; buf: Buffer }[]; title: string }> {
  const meta = await spotifyMeta(rawUrl)
  if (meta.kind === 'track') {
    const buf = await trackAudio(meta.title, meta.artist)
    return { media: [{ type: 'audio', buf }], title: `${meta.title} by ${meta.artist}` }
  }
  // album: sequential (RAM-friendly), skip tracks that fail so one miss doesn't kill the album
  const media: { type: 'audio'; buf: Buffer }[] = []
  for (const t of meta.tracks) {
    try {
      media.push({ type: 'audio', buf: await trackAudio(t.title, t.artist) })
    } catch {
      /* skip — keep the rest of the album */
    }
  }
  if (!media.length) throw new Error('spotify: album download failed')
  return { media, title: `${meta.title} by ${meta.artist} (${media.length}/${meta.tracks.length} tracks)` }
}

if (process.env.SPOTIFY_SELFTEST) {
  if (idOf('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'track') !== '4uLU6hMCjMI75M1A2tKUQC') {
    throw new Error('trackIdOf fail')
  }
  if (idOf('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc', 'album') !== '2noRn2Aes5aoNVsU6iWThc') {
    throw new Error('albumIdOf fail')
  }
  if (idOf('https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc', 'track')) throw new Error('album should not match track')
  if (idOf('https://example.com/', 'track')) throw new Error('non-spotify should not match')
  const fixture = {
    props: { pageProps: { state: { data: { entity: {
      name: 'x', uri: 'spotify:track:abc', title: 'Never Gonna Give You Up',
      artists: [{ name: 'Rick Astley', uri: 'spotify:artist:x' }],
    } } } } },
  }
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(fixture)}</script>`
  const blob = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
  if (!blob) throw new Error('selftest fixture fail')
  const json = JSON.parse(blob)
  const walk = (o: any, out: any[] = []): any[] => {
    if (!o || typeof o !== 'object') return out
    if (typeof o.name === 'string' && o.uri?.includes('track')) out.push(o)
    for (const v of Object.values(o)) walk(v, out)
    return out
  }
  const track = walk(json)[0]
  if (track?.title !== 'Never Gonna Give You Up' || track?.artists?.[0]?.name !== 'Rick Astley') {
    throw new Error('next-data walk fail')
  }
  console.log('spotify self-check ok')
  process.exit(0)
}
