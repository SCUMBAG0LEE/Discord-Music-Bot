import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to play next',
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
    name: 'playnext',
    description: 'Add a song to play next in the queue'
})
@Options(options)
export default class PlayNextCommand extends Command {
    async run(ctx) {
        const { query, platform } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            logger.warn('PlayNextCommand', `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`);
            return;
        }
        
        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            const searchPrefix = platform === 'soundcloud' ? 'scsearch1:' : 'ytsearch1:';
            
            await musicManager.playNextSong(channel, query, ctx, searchPrefix);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
