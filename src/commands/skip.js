import { Command, Declare } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

@Declare({
    name: 'skip',
    description: 'Skip the current playing song'
})
export default class SkipCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.write({ content: 'There is no music playing to skip.', flags: 64 });
        }
        
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        musicManager.skip(ctx.guildId);
        await ctx.write({ content: '⏭️ Skipped the song!' });
    }
}
