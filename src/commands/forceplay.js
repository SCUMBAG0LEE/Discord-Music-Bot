import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { isDJ, djOnlyError, verifyVoiceConnection } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to force play immediately',
        required: true
    }),
    platform: createStringOption({
        description: 'Platform search engine if not using a URL (default: YouTube)',
        required: false,
        choices: [
            { name: '🔴 YouTube', value: 'youtube' },
            { name: '🟠 SoundCloud', value: 'soundcloud' }
        ]
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

        const { query, platform } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            logger.warn('ForcePlayCommand', `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`);
            return;
        }
        
        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            const searchPrefix = platform === 'soundcloud' ? 'scsearch1:' : 'ytsearch1:';
            
            await musicManager.forcePlay(channel, query, ctx, searchPrefix);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
