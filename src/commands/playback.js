import { Command, Declare, Options, createIntegerOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

@Declare({
    name: 'pause',
    description: 'Pause the current playing music'
})
export class PauseCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.write({ content: 'There is no music playing.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

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
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.write({ content: 'There is no active queue.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!queue.paused) {
            return ctx.write({ content: 'Playback is not paused.', flags: 64 });
        }
        
        musicManager.resume(ctx.guildId);
        await ctx.write({ content: '▶️ Playback resumed.' });
    }
}

const volumeOptions = {
    level: createIntegerOption({
        description: 'Volume level (0-200, default is 100)',
        required: true,
        min_value: 0,
        max_value: 200
    })
};

@Declare({
    name: 'volume',
    description: 'Set playback volume'
})
@Options(volumeOptions)
export class VolumeCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.write({ content: 'There is no active queue.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const level = ctx.options.level;
        musicManager.setVolume(ctx.guildId, level);
        
        const emoji = level === 0 ? '🔇' : level < 50 ? '🔈' : level < 100 ? '🔉' : '🔊';
        await ctx.write({ content: `${emoji} Volume set to **${level}%**` });
    }
}
