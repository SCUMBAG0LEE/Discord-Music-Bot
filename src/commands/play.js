import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song',
        required: true
    })
};

@Declare({
    name: 'play',
    description: 'Play a song from YouTube'
})
@Options(options)
export default class PlayCommand extends Command {
    async run(ctx) {
        const { query } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;
        
        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[PlayCommand] Failed to defer interaction (likely timeout or unknown interaction):`, e.message || e);
            return;
        }
        
        try {
            const channel = await ctx.client.cache.channels?.get(voiceChannelId);
            if (!channel) {
                return ctx.editOrReply({ content: '❌ Could not fetch your voice channel from the cache.' });
            }
            
            await musicManager.play(channel, query, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
