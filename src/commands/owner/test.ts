const IMG = 'https://www.its.ac.id/tki/wp-content/uploads/sites/53/2025/08/pp-kosong-wa-default.jpg'

export default {
  name: 'test',
  desc: 'test fakeloc dengan thumbnail gambar',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    const res = await fetch(IMG)
    if (!res.ok) throw new Error(`fetch image failed: ${res.status}`)
    const jpegThumbnail = Buffer.from(await res.arrayBuffer())
    await ctx.sock.sendMessage(ctx.chat, {
      location: {
        degreesLatitude: -6.2,
        degreesLongitude: 106.816666,
        name: 'Test Location',
        jpegThumbnail,
      },
    } as any)
  },
} satisfies Command
