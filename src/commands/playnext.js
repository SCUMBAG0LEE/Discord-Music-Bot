import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to play next',
        required: true
    })
};

@Declare({
    name: 'playnext',
    description: 'Add a song to play next in the queue'
})
@Options(options)
export default class PlayNextCommand extends Command {
    async run(ctx) {
        const { query } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[PlayNextCommand] Failed to defer interaction (likely timeout or unknown interaction):`, e.message || e);
            return;
        }
        
        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            
            await musicManager.playNextSong(channel, query, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
