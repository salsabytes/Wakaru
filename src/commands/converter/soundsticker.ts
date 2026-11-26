// .ss — two-step sound sticker: the picture/video is captured first, the bot
// then asks for the sound and only the command sender's answer is accepted
// (1 minute). The flow state lives in lib/soundStickerFlow.ts because the reply
// is often a media-only message, which never reaches command dispatch.
import { startSoundSticker } from '../../lib/soundStickerFlow.ts'

export default {
  name: 'soundsticker',
  desc: 'sticker with sound — send/reply a photo or video, then answer with the sound',
  aliases: ['as', 'ss'],
  cooldown: 10,
  run: startSoundSticker,
} satisfies Command
