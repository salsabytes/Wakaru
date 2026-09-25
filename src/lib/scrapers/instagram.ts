import { wakafy } from './wakafy.ts'

// reels, posts, carousels, stories, highlights — one call, API handles the rest
export const downloadInstagram = (rawUrl: string) => wakafy.media('/v1/media/igdl', rawUrl, { label: 'instagram' })
