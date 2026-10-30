import { Command, Declare, type CommandContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, canUseDJCommands } from '../utils/permissions.js';

@Declare({
    name: 'skip',
    description: 'Skip the current playing song'
})
export default class SkipCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue) {
            return ctx.write({ content: 'There is no music playing to skip.', flags: 64 });
        }

        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!(await canUseDJCommands(ctx, queue))) {
            return ctx.write({
                content: '🔒 Only DJs or the song requester can force-skip. Use `/voteskip` instead!',
                flags: 64
            });
        }

        musicManager.skip(ctx.guildId);
        await ctx.write({ content: '⏭️ Skipped the song!' });
    }
}

