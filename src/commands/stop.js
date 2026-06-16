import { Command, Declare } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

@Declare({
    name: 'stop',
    description: 'Stop the music and clear the queue'
})
export default class StopCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.write({ content: 'There is no music playing.', flags: 64 });
        }
        
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        musicManager.leave(ctx.guildId);
        await ctx.write({ content: '⏹️ Stopped the music and cleared the queue.' });
    }
}
