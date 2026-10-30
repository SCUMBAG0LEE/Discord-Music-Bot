import { Command, Declare, Options, Embed, createStringOption, type CommandContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { canUseDJCommands, djOnlyError, verifyVoiceConnection, verifyTextChannel } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

function parseTimeToSeconds(timeStr: string): number {
    if (!timeStr) return 0;

    if (!isNaN(Number(timeStr))) {
        return parseInt(timeStr, 10);
    }

    const parts = timeStr.split(':').map(Number);
    if (parts.some(isNaN)) return -1;

    if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return -1;
}

const seekOptions = {
    time: createStringOption({
        description: 'Time to seek to (e.g., 120, 2:00, +15, -10)',
        required: true
    })
};

@Declare({
    name: 'seek',
    description: 'Jump to a specific timestamp in the current song'
})
@Options(seekOptions)
export class SeekCommand extends Command {
    async run(ctx: CommandContext<typeof seekOptions>): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'There is no song playing.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
        }

        const song = queue.songs[0];
        if (song.sourceType === 'radio' || song.isRadio) {
            return ctx.write({ content: '❌ Cannot seek on a live radio stream.', flags: 64 });
        }

        const timeStr = ctx.options.time.trim();
        let seconds: number;

        if (timeStr.startsWith('+') || timeStr.startsWith('-')) {
            const sign = timeStr.startsWith('-') ? -1 : 1;
            const delta = parseTimeToSeconds(timeStr.slice(1));
            if (delta < 0) {
                return ctx.write({
                    content: '❌ Invalid relative time format. Use seconds (e.g., `+15`, `-10`) or mm:ss.',
                    flags: 64
                });
            }
            const currentElapsed = musicManager.getPlaybackElapsedSeconds(queue);
            seconds = Math.max(0, currentElapsed + sign * delta);
        } else {
            seconds = parseTimeToSeconds(timeStr);
        }

        if (seconds < 0) {
            return ctx.write({
                content: '❌ Invalid time format. Use seconds (e.g., `120`) or mm:ss (e.g., `2:00`).',
                flags: 64
            });
        }

        musicManager.seek(ctx.guildId, seconds);

        await ctx.write({ content: `⏩ Seeking to \`${timeStr}\`...` });
    }
}

@Declare({
    name: 'previous',
    description: 'Play the previous song in the queue history'
})
export class PreviousCommand extends Command {
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

        if (queue.history.length === 0) {
            return ctx.write({ content: 'No previous songs in history.', flags: 64 });
        }

        musicManager.previous(ctx.guildId);
        await ctx.write({ content: '⏮️ Playing previous song...' });
    }
}

@Declare({
    name: 'replay',
    description: 'Restart the current song from the beginning'
})
export class ReplayCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'There is no song playing.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        if (!(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
        }

        musicManager.seek(ctx.guildId, 0);

        await ctx.write({ content: '🔁 Replaying the current song...' });
    }
}

const radioOptions = {
    station: createStringOption({
        description: 'Station preset to play',
        required: false,
        choices: [
            { name: '🎧 Lo-Fi Hip Hop', value: 'lofi' },
            { name: '🎷 Jazz', value: 'jazz' },
            { name: '🎻 Classical', value: 'classical' },
            { name: '☕ Chillhop', value: 'chillhop' },
            { name: '🌃 Synthwave', value: 'synthwave' },
            { name: '🎸 Rock', value: 'rock' },
            { name: '🎹 Electronic', value: 'electronic' },
            { name: '🌿 Ambient', value: 'ambient' },
            { name: '🎤 Hip Hop', value: 'hiphop' }
        ]
    })
};

@Declare({
    name: 'radio',
    description: 'List available radio presets or play one'
})
@Options(radioOptions)
export class RadioCommand extends Command {
    async run(ctx: CommandContext<typeof radioOptions>): Promise<any> {
        if (!ctx.guildId) return;
        const station = ctx.options.station;

        if (!station) {
            if (!(await verifyTextChannel(ctx))) return;
            const embed = new Embed()
                .setTitle('📻 Radio Stations')
                .setColor('#5865F2')
                .setDescription(
                    '**Available Presets:**\n' +
                        '🎧 lofi — Lo-Fi Hip Hop\n' +
                        '🎷 jazz — Jazz Radio\n' +
                        '🎻 classical — Classical Music\n' +
                        '☕ chillhop — Chillhop Music\n' +
                        '🌃 synthwave — Synthwave/Retrowave\n' +
                        '🎸 rock — Rock Radio\n' +
                        '🎹 electronic — Electronic/Techno\n' +
                        '🌿 ambient — Ambient Chill\n' +
                        '🎤 hiphop — Hip Hop Radio\n\n' +
                        '*Use `/radio <station>` or `/play <station>` to tune in!*'
                );
            return ctx.write({ embeds: [embed] });
        }

        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn(
                'AdvancedCommand',
                `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`
            );
            return;
        }

        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            await musicManager.play(channel, station, ctx);
        } catch (e: any) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}

