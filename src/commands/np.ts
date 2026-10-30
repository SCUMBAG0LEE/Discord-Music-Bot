import { Command, Declare, Embed, type CommandContext } from 'seyfert';
import { musicManager, getPlayerControls } from '../services/MusicManager.js';
import { formatDuration, parseTimestamp, buildProgressBar } from '../utils/formatters.js';
import { verifyTextChannel } from '../utils/permissions.js';

async function handleNowPlaying(ctx: CommandContext): Promise<any> {
    if (!ctx.guildId) return;
    if (!(await verifyTextChannel(ctx))) return;

    const queue = musicManager.getQueue(ctx.guildId);

    if (!queue || queue.songs.length === 0) {
        return ctx.write({ content: 'No song is currently playing.', flags: 64 });
    }

    const song = queue.songs[0];
    const elapsedSec = musicManager.getPlaybackElapsedSeconds(queue);
    const totalSec =
        typeof song.durationInSec === 'number' && song.durationInSec > 0
            ? song.durationInSec
            : parseTimestamp(song.duration) ?? 0;

    const isLive = song.sourceType === 'radio' || song.isRadio || totalSec <= 0;
    const progressBar = isLive ? '🔴 LIVE STREAM' : buildProgressBar(elapsedSec, totalSec);
    const timeDisplay = isLive
        ? `\`${formatDuration(elapsedSec)} / LIVE\``
        : `\`${formatDuration(elapsedSec)} / ${song.duration || formatDuration(totalSec)}\``;

    const requesterStr = song.requesterId
        ? `<@${song.requesterId}>`
        : song.requesterName || 'Unknown';
    const platformStr = (song.sourceType || 'youtube').toUpperCase();
    const loopStr = queue.loopMode === 1 ? 'Song' : queue.loopMode === 2 ? 'Queue' : 'Off';
    const autoplayStr = queue.autoplay ? 'On' : 'Off';

    const embed = new Embed()
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${song.title}](${song.originalUrl})**\n\n${progressBar} ${timeDisplay}`)
        .addFields([
            { name: '👤 Requested By', value: requesterStr, inline: true },
            { name: '🌐 Platform', value: platformStr, inline: true },
            { name: '🔁 Loop', value: loopStr, inline: true },
            { name: '📻 Autoplay', value: autoplayStr, inline: true }
        ])
        .setColor('#5865F2')
        .setFooter({ text: `${queue.paused ? '⏸️ Paused' : '▶️ Playing'}` });

    const row = getPlayerControls(queue);

    // Clean up button controls on previous Now Playing message
    if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
        try {
            await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, {
                components: []
            });
        } catch {}
        queue.lastNowPlayingMessageId = null;
    }

    const sentMsg = await ctx.write({ embeds: [embed], components: [row] }, true);
    if (sentMsg && (sentMsg as any).id) {
        queue.lastNowPlayingMessageId = (sentMsg as any).id;
        if (ctx.channelId) {
            queue.textChannelId = ctx.channelId;
        }
    }
}

@Declare({
    name: 'nowplaying',
    description: 'Display the currently playing song'
})
export class NowPlayingCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        return handleNowPlaying(ctx);
    }
}

@Declare({
    name: 'np',
    description: 'Display the currently playing song (alias for /nowplaying)'
})
export class NpCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        return handleNowPlaying(ctx);
    }
}

export default NowPlayingCommand;

