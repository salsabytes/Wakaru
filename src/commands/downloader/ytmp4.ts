import { makeDownloader } from './factory.ts'

export default makeDownloader({
  name: 'ytmp4',
  desc: 'download video (mp4) from a video link',
  aliases: ['ytv', 'video'],
  mode: 'video',
  usage: '<video url>',
  waiting: true,
})