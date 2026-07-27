import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { isDJ, djOnlyError, verifyVoiceConnection } from '../utils/permissions.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to force play immediately',
        required: true
    })
};

@Declare({
    name: 'forceplay',
    description: 'Play a song immediately, skipping the current one (DJ only)'
})
@Options(options)
export default class ForcePlayCommand extends Command {
    async run(ctx) {
        if (!await isDJ(ctx.member)) {
            return djOnlyError(ctx);
        }

        const { query } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[ForcePlayCommand] Failed to defer interaction (likely timeout or unknown interaction):`, e.message || e);
            return;
        }
        
        try {
            let channel = await ctx.client.cache.channels?.get(voiceChannelId);
            if (!channel) {
                try {
                    channel = await ctx.client.channels.fetch(voiceChannelId);
                } catch (e) {
                    channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
                }
            }
            
            await musicManager.forcePlay(channel, query, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
