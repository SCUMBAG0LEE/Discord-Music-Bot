import { Command, Declare } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';

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
        
        musicManager.skip(ctx.guildId);
        await ctx.write({ content: '⏭️ Skipped the song!' });
    }
}
