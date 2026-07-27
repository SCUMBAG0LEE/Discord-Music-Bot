import { Command, Declare, Embed, Options, createStringOption } from 'seyfert';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { musicManager, ffmpegInfo, hardwareOptimization, execFileAsync } from '../services/MusicManager.js';
import { getVoiceConnection } from '@discordjs/voice';
import { isOwner } from '../utils/permissions.js';

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
@Declare({
    name: 'ping',
    description: 'Check bot latency'
})
export class PingCommand extends Command {
    async run(ctx) {
        const start = Date.now();
        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[PingCommand] Failed to defer interaction (likely timeout or unknown interaction):`, e.message || e);
            return;
        }
        const wsPing = ctx.client.gateway.latency;
        const latency = Date.now() - start;

        let proxyStatus = "⚪ Disabled";
        if (process.env.YOUTUBE_PROXY) {
            const proxyStart = Date.now();
            try {
                try {
                    await fetch('https://www.youtube.com', { 
                        method: 'HEAD', 
                        signal: AbortSignal.timeout(2500),
                        proxy: process.env.YOUTUBE_PROXY 
                    });
                    const proxyLatency = Date.now() - proxyStart;
                    proxyStatus = `🟢 ${proxyLatency}ms`;
                } catch (fetchErr) {
                    await execFileAsync('curl', ['-s', '-I', '-x', process.env.YOUTUBE_PROXY, 'https://www.youtube.com', '--connect-timeout', '2'], { timeout: 2500 });
                    const proxyLatency = Date.now() - proxyStart;
                    proxyStatus = `🟢 ${proxyLatency}ms`;
                }
            } catch(e) {
                proxyStatus = "🔴 Connection Failed (Offline/Invalid)";
            }
        }

        const embed = new Embed()
            .setTitle('🏓 Pong!')
            .setColor('#00FF00')
            .addFields(
                { name: 'Bot Latency', value: `${latency}ms`, inline: true },
                { name: 'Websocket Ping', value: `${wsPing}ms`, inline: true },
                { name: 'API Time', value: `${Date.now() - start}ms`, inline: true },
                { name: 'YouTube Proxy', value: proxyStatus, inline: false }
            );

        await ctx.editOrReply({ embeds: [embed] });
    }
}

// StatsCommand merged into DebugCommand

@Declare({
    name: 'debug',
    description: 'Show advanced debugging information for the bot and music player'
})
export class DebugCommand extends Command {
    async run(ctx) {
        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[DebugCommand] Failed to defer:`, e.message || e);
            return;
        }

        const queue = musicManager.getQueue(ctx.guildId);
        const connection = getVoiceConnection(ctx.guildId);

        const uptime = formatDuration(Math.floor(process.uptime()));
        const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        let runtimeName = 'Node.js';
        if (typeof Bun !== 'undefined') runtimeName = 'Bun';
        else if (typeof Deno !== 'undefined') runtimeName = 'Deno';

        let debugInfo = `**Bot Status:**\n`;
        debugInfo += `> **Runtime:** \`${runtimeName}\` (${os.arch()})\n`;
        debugInfo += `> **Bot Uptime:** \`${uptime}\` | **Memory:** \`${memUsage} MB\`\n\n`;

        if (queue && connection) {
            debugInfo += `**Voice Connection & Player:**\n`;
            debugInfo += `> **Connection:** \`${connection.state.status}\` | **Player:** \`${queue.player.state.status}\`\n`;
            debugInfo += `> **Queue Length:** \`${queue.songs.length}\` | **Playing:** \`${queue.playing ? 'Yes' : 'No'}\` | **Paused:** \`${queue.paused ? 'Yes' : 'No'}\`\n`;

            const currentSong = queue.songs[0];
            if (currentSong && currentSong._ytDlpData) {
                const streamData = currentSong._ytDlpData;
                const bitrateVal = streamData.abr || streamData.tbr;
                const bitrateStr = bitrateVal ? `${typeof bitrateVal === 'number' ? bitrateVal.toFixed(1) : bitrateVal} kbps` : 'N/A';
                
                // Source Platform & Protocol
                const platformName = currentSong.sourceType ? currentSong.sourceType.toUpperCase() : (streamData.extractor ? streamData.extractor.toUpperCase() : 'UNKNOWN');
                const targetProtocol = (currentSong.sourceType === 'radio' || currentSong.isRadio) ? 'HTTP Stream' : 'HTTPS/QUIC';
                
                // Proxy Route
                const proxyUrl = process.env.YOUTUBE_PROXY || '';
                const proxyScheme = proxyUrl ? (proxyUrl.includes('://') ? proxyUrl.split('://')[0].toUpperCase() : 'PROXY') : '';
                const proxyLabel = proxyUrl ? `${proxyScheme} Proxy` : 'Direct (No Proxy)';

                debugInfo += `\n**Stream Info:**\n`;
                debugInfo += `> **Engine Mode:** \`${streamData._processingMode || 'N/A'}\`\n`;
                debugInfo += `> **Transport:** \`${streamData._transportMode || 'N/A'}\`\n`;
                debugInfo += `> **Source Platform:** \`${platformName} (${targetProtocol})\`\n`;
                debugInfo += `> **Proxy Route:** \`${proxyLabel}\`\n`;
                debugInfo += `> **Audio Delivery:** \`UDP (Discord Voice Socket)\`\n`;
                debugInfo += `> **Source Codec:** \`${streamData.acodec || 'N/A'}\`\n`;
                debugInfo += `> **Bitrate:** \`${bitrateStr}\`\n`;
                debugInfo += `> **Sample Rate:** \`${streamData.asr ? `${streamData.asr} Hz` : 'N/A'}\`\n`;
                const codecExt = (streamData.acodec && streamData.ext) ? `${streamData.acodec}/${streamData.ext}` : (streamData.ext || 'N/A');
                debugInfo += `> **Format ID:** \`${streamData.format_id || 'N/A'} (${codecExt})\`\n`;
            }
        } else {
            debugInfo += `**Voice Connection:** None\n`;
            debugInfo += `**Queue:** Not initialized\n`;
        }
        const embed = new Embed()
            .setTitle('🛠️ Debug Info')
            .setDescription(debugInfo)
            .setColor('#ED4245');

        await ctx.editOrReply({ embeds: [embed] });
    }
}

const helpOptions = {
    category: createStringOption({
        description: 'Show help for a specific category',
        choices: [
            { name: '🎶 Playing Music', value: 'playing' },
            { name: '⏯️ Playback', value: 'playback' },
            { name: '📋 Queue', value: 'queue' },
            { name: '🔧 Utility', value: 'utility' }
        ]
    })
};

@Declare({
    name: 'help',
    description: 'Show help for available commands.'
})
@Options(helpOptions)
export class HelpCommand extends Command {
    async run(ctx) {
        const category = ctx.options.category;

        const categoryData = {
            playing: {
                title: '🎶 Playing Music Commands',
                fields: [
                    { name: '`/play <query>`', value: 'Play a track or playlist from YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch, or direct audio link.' },
                    { name: '`/forceplay <query>`', value: 'Force play a song immediately, clearing or interrupting current playback.' },
                    { name: '`/playnext <query>`', value: 'Add a track to the very front of the queue to play next.' },
                    { name: '`/search <query> [platform]`', value: 'Search interactively on YouTube or SoundCloud and pick a result.' },
                    { name: '`/radio <preset|url>`', value: 'Stream live internet radio stations or built-in presets (lofi, jazz, synthwave, etc.).' }
                ]
            },
            playback: {
                title: '⏯️ Playback Control Commands',
                fields: [
                    { name: '`/pause`', value: 'Pause current audio playback.' },
                    { name: '`/resume`', value: 'Resume paused audio playback.' },
                    { name: '`/stop`', value: 'Stop playback, clear queue, and leave voice channel.' },
                    { name: '`/seek <timestamp>`', value: 'Seek to a specific timestamp in the current song (e.g. `1:30`, `90`).' },
                    { name: '`/replay`', value: 'Restart the currently playing song from the beginning.' },
                    { name: '`/previous`', value: 'Play the previously played song from history.' }
                ]
            },
            queue: {
                title: '📋 Queue Commands',
                fields: [
                    { name: '`/queue [page]`', value: 'View the paginated song queue.' },
                    { name: '`/nowplaying` / `/np`', value: 'Show interactive Now Playing embed with live progress bar.' },
                    { name: '`/shuffle`', value: 'Randomize the order of songs in the queue.' },
                    { name: '`/clear`', value: 'Remove all upcoming songs from the queue.' },
                    { name: '`/remove <position>`', value: 'Remove a specific song by its queue position.' },
                    { name: '`/move <from> <to>`', value: 'Reorder a song from one position to another.' },
                    { name: '`/jump <position>` / `/skipto`', value: 'Jump directly to a song in the queue.' },
                    { name: '`/skip` / `/voteskip`', value: 'Skip the current track (or start a vote skip).' }
                ]
            },
            utility: {
                title: '🔧 Utility Commands',
                fields: [
                    { name: '`/help [category]`', value: 'Display command guide and category breakdowns.' },
                    { name: '`/ping`', value: 'Check bot latency, gateway ping, and YouTube proxy status.' },
                    { name: '`/debug`', value: 'View detailed server hardware, yt-dlp, FFmpeg, and voice stream diagnostics.' },
                    { name: '`/lyrics [query]`', value: 'Search and display song lyrics.' }
                ]
            }
        };

        if (category && categoryData[category]) {
            const data = categoryData[category];
            const embed = new Embed()
                .setColor('#5865F2')
                .setTitle(data.title)
                .addFields(data.fields)
                .setFooter({ text: 'Powered by Seyfert' });
            await ctx.write({ embeds: [embed] });
            return;
        }

        const helpEmbed = new Embed()
            .setColor('#5865F2')
            .setTitle('🎵 Music Bot Commands')
            .addFields(
                { name: '🎶 Playing Music', value: '`/play` `/forceplay` `/playnext` `/search` `/radio`', inline: false },
                { name: '⏯️ Playback Control', value: '`/pause` `/resume` `/stop` `/seek` `/replay` `/previous`', inline: false },
                { name: '📋 Queue Management', value: '`/queue` `/nowplaying` `/shuffle` `/clear` `/remove` `/move` `/jump` `/skip` `/voteskip`', inline: false },
                { name: '🔧 Utility', value: '`/help` `/ping` `/debug` `/lyrics`', inline: false }
            )
            .setFooter({ text: 'Use /help category:<name> for detailed usage of any section' });

        await ctx.write({ embeds: [helpEmbed] });
    }
}
