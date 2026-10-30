import { Command, Declare, type CommandContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, canUseDJCommands, djOnlyError } from '../utils/permissions.js';

@Declare({
    name: 'pause',
    description: 'Pause the current playing music'
})
export class PauseCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue) {
            return ctx.write({ content: 'There is no music playing.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
        }

        if (queue.paused) {
            return ctx.write({ content: 'Playback is already paused.', flags: 64 });
        }

        musicManager.pause(ctx.guildId);
        await ctx.write({ content: '⏸️ Playback paused.' });
    }
}

@Declare({
    name: 'resume',
    description: 'Resume the paused music'
})
export class ResumeCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue) {
            return ctx.write({ content: 'There is no active queue.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
        }

        if (!queue.paused) {
            return ctx.write({ content: 'Playback is not paused.', flags: 64 });
        }

        musicManager.resume(ctx.guildId);
        await ctx.write({ content: '▶️ Playback resumed.' });
    }
}

