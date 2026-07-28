import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song',
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
    name: 'play',
    description: 'Play a song from YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch, or direct link'
})
@Options(options)
export default class PlayCommand extends Command {
    async run(ctx) {
        const { query, platform } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;
        
        try {
            await ctx.deferReply();
        } catch (e) {
            logger.warn('PlayCommand', `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`);
            return;
        }
        
        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            const searchPrefix = platform === 'soundcloud' ? 'scsearch1:' : 'ytsearch1:';
            
            await musicManager.play(channel, query, ctx, searchPrefix);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
