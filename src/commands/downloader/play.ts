import { handlePlayPick, pendingPlay, startPlay } from '../../lib/play.ts'

export { handlePlayPick, pendingPlay }

export default {
  name: 'play',
  desc: 'search YouTube by query, pick a result, download mp3/mp4',
  aliases: ['yt', 'song'],
  run: startPlay,
} satisfies Command
