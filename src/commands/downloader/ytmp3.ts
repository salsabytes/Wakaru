import { makeDownloader } from './factory.ts'

export default makeDownloader({
  name: 'ytmp3',
  desc: 'download audio (mp3) from a video link',
  aliases: ['ytm', 'music'],
  mode: 'audio',
  usage: '<video/song url>',
  waiting: true,
})