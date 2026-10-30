import { Command, Declare, Embed, Options, createStringOption, type CommandContext } from 'seyfert';
import os from 'os';
import { musicManager, execFileAsync } from '../services/MusicManager.js';
import { getVoiceConnection } from '@discordjs/voice';
import { verifyTextChannel } from '../utils/permissions.js';
import { formatDuration } from '../utils/formatters.js';
import { logger } from '../utils/logger.js';

@Declare({
    name: 'ping',
    description: 'Check bot latency'
})
export class PingCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!(await verifyTextChannel(ctx))) return;

        const start = Date.now();
        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn(
                'PingCommand',
                `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`
            );
            return;
        }
        const wsPing = ctx.client.gateway.latency;
        const latency = Date.now() - start;

        let proxyStatus = '⚪ Disabled';
        if (process.env.YOUTUBE_PROXY) {
            const proxyStart = Date.now();
            try {
                try {
                    await fetch('https://www.youtube.com', {
                        method: 'HEAD',
                        signal: AbortSignal.timeout(2500),
                        proxy: process.env.YOUTUBE_PROXY
                    } as any);
                    const proxyLatency = Date.now() - proxyStart;
                    proxyStatus = `🟢 ${proxyLatency}ms`;
                } catch {
                    await execFileAsync(
                        'curl',
                        [
                            '-s',
                            '-I',
                            '-x',
                            process.env.YOUTUBE_PROXY,
                            'https://www.youtube.com',
                            '--connect-timeout',
                            '2'
                        ],
                        { timeout: 2500 }
                    );
                    const proxyLatency = Date.now() - proxyStart;
                    proxyStatus = `🟢 ${proxyLatency}ms`;
                }
            } catch {
                proxyStatus = '🔴 Connection Failed (Offline/Invalid)';
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

@Declare({
    name: 'debug',
    description: 'Show advanced debugging information for the bot and music player'
})
export class DebugCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!(await verifyTextChannel(ctx))) return;

        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn('DebugCommand', `Failed to defer: ${e.message || e}`);
            return;
        }

        const queue = ctx.guildId ? musicManager.getQueue(ctx.guildId) : undefined;
        const connection = ctx.guildId ? getVoiceConnection(ctx.guildId) : undefined;

        const uptime = formatDuration(Math.floor(process.uptime()));
        const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        let runtimeName = 'Node.js';
        if (typeof Bun !== 'undefined') runtimeName = 'Bun';

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
                const bitrateStr = bitrateVal
                    ? `${typeof bitrateVal === 'number' ? bitrateVal.toFixed(1) : bitrateVal} kbps`
                    : 'N/A';

                const platformName = currentSong.sourceType
                    ? currentSong.sourceType.toUpperCase()
                    : streamData.extractor
                      ? streamData.extractor.toUpperCase()
                      : 'UNKNOWN';
                const targetProtocol =
                    currentSong.sourceType === 'radio' || currentSong.isRadio ? 'HTTP Stream' : 'HTTPS/QUIC';

                const proxyUrl = process.env.YOUTUBE_PROXY || '';
                const proxyScheme = proxyUrl
                    ? proxyUrl.includes('://')
                        ? proxyUrl.split('://')[0].toUpperCase()
                        : 'PROXY'
                    : '';
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
                const codecExt =
                    streamData.acodec && streamData.ext
                        ? `${streamData.acodec}/${streamData.ext}`
                        : streamData.ext || 'N/A';
                debugInfo += `> **Format ID:** \`${streamData.format_id || 'N/A'} (${codecExt})\`\n`;
            }
        } else {
            debugInfo += `**Voice Connection:** None\n`;
            debugInfo += `**Queue:** Not initialized\n`;
        }
        const embed = new Embed().setTitle('🛠️ Debug Info').setDescription(debugInfo).setColor('#ED4245');

        await ctx.editOrReply({ embeds: [embed] });
    }
}

@Declare({
    name: 'stats',
    description: 'Show bot stats and music player diagnostics (alias for /debug)'
})
export class StatsCommand extends DebugCommand {}

const helpOptions = {
    category: createStringOption({
        description: 'Show help for a specific category',
        choices: [
            { name: '🎶 Playing Music', value: 'playing' },
            { name: '⏯️ Playback', value: 'playback' },
            { name: '📋 Queue', value: 'queue' },
            { name: '💾 Playlists & Favorites', value: 'playlists' },
            { name: '⚙️ Settings & Admin', value: 'settings' },
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
    async run(ctx: CommandContext<typeof helpOptions>): Promise<any> {
        if (!(await verifyTextChannel(ctx))) return;

        const category = ctx.options.category;

        const categoryData: Record<string, { title: string; fields: Array<{ name: string; value: string }> }> = {
            playing: {
                title: '🎶 Playing Music Commands',
                fields: [
                    {
                        name: '`/play <query>`',
                        value: 'Play a track or playlist from YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch, or direct audio link.'
                    },
                    {
                        name: '`/forceplay <query>`',
                        value: 'Force play a song immediately, clearing or interrupting current playback.'
                    },
                    {
                        name: '`/playnext <query>`',
                        value: 'Add a track to the very front of the queue to play next.'
                    },
                    {
                        name: '`/search <query> [platform]`',
                        value: 'Search interactively on YouTube or SoundCloud and pick a result.'
                    },
                    {
                        name: '`/radio <preset|url>`',
                        value: 'Stream live internet radio stations or built-in presets (lofi, jazz, synthwave, etc.).'
                    }
                ]
            },
            playback: {
                title: '⏯️ Playback Control Commands',
                fields: [
                    { name: '`/pause`', value: 'Pause current audio playback.' },
                    { name: '`/resume`', value: 'Resume paused audio playback.' },
                    {
                        name: '`/disconnect` / `/leave` / `/dc` / `/stop`',
                        value: 'Disconnect bot from voice channel, stop playback, and clear queue.'
                    },
                    {
                        name: '`/seek <timestamp>`',
                        value: 'Seek to a specific timestamp in the current song (e.g. `1:30`, `90`).'
                    },
                    { name: '`/replay`', value: 'Restart the currently playing song from the beginning.' },
                    { name: '`/previous`', value: 'Play the previously played song from history.' }
                ]
            },
            queue: {
                title: '📋 Queue Commands',
                fields: [
                    { name: '`/queue [page]`', value: 'View the paginated song queue.' },
                    {
                        name: '`/nowplaying` / `/np`',
                        value: 'Show interactive Now Playing embed with live progress bar.'
                    },
                    { name: '`/shuffle`', value: 'Randomize the order of songs in the queue.' },
                    { name: '`/clear`', value: 'Remove all upcoming songs from the queue.' },
                    { name: '`/remove <position>`', value: 'Remove a specific song by its queue position.' },
                    { name: '`/move <from> <to>`', value: 'Reorder a song from one position to another.' },
                    { name: '`/jump <position>` / `/skipto`', value: 'Jump directly to a song in the queue.' },
                    { name: '`/skip` / `/voteskip`', value: 'Skip the current track (or start a vote skip).' }
                ]
            },
            playlists: {
                title: '💾 Playlists & Favorites Commands',
                fields: [
                    {
                        name: '`/playlist <save|load|list|delete|append>`',
                        value: 'Save the current queue, load a saved playlist, list or delete playlists, or append the queue to an existing playlist.'
                    },
                    {
                        name: '`/savelist` / `/loadlist` / `/playlists` / `/deletelist` / `/appendlist`',
                        value: 'Top-level shortcut aliases for playlist management.'
                    },
                    {
                        name: '`/favorite <add|list>`',
                        value: 'Add the currently playing song to your favorites or list/play your favorites.'
                    },
                    {
                        name: '`/like` / `/favorites`',
                        value: 'Top-level shortcut aliases for adding and viewing favorite tracks.'
                    }
                ]
            },
            settings: {
                title: '⚙️ Settings & Admin Commands',
                fields: [
                    { name: '`/settings`', value: 'Configure server-wide music bot settings via subcommands.' },
                    { name: '`/loop <mode>`', value: 'Set loop mode (Off, Track, or Queue).' },
                    { name: '`/autoplay <enabled>`', value: 'Toggle automatic related-track playback when the queue ends.' },
                    { name: '`/247`', value: 'Toggle 24/7 mode to keep the bot in the voice channel.' },
                    { name: '`/settc` / `/setvc` / `/setdjrole`', value: 'Bind the bot to a text channel, voice channel, or DJ role.' },
                    { name: '`/queuetype` / `/skipratio` / `/maxduration`', value: 'Configure queue fairness (linear/fair), vote-skip ratio, or max track duration.' },
                    { name: '`/songinstatus` / `/serversettings`', value: 'Toggle showing the current song in voice status or view all server settings.' },
                    { name: '`/forceremove <user>`', value: 'Remove all songs queued by a specific user.' }
                ]
            },
            utility: {
                title: '🔧 Utility Commands',
                fields: [
                    { name: '`/help [category]`', value: 'Display command guide and category breakdowns.' },
                    { name: '`/ping`', value: 'Check bot latency, gateway ping, and YouTube proxy status.' },
                    {
                        name: '`/debug` / `/stats`',
                        value: 'View detailed server hardware, yt-dlp, FFmpeg, and voice stream diagnostics.'
                    },
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
                {
                    name: '⏯️ Playback Control',
                    value: '`/pause` `/resume` `/stop` `/seek` `/replay` `/previous`',
                    inline: false
                },
                {
                    name: '📋 Queue Management',
                    value: '`/queue` `/nowplaying` `/shuffle` `/clear` `/remove` `/move` `/jump` `/skip` `/voteskip`',
                    inline: false
                },
                {
                    name: '💾 Playlists & Favorites',
                    value: '`/playlist` `/savelist` `/loadlist` `/playlists` `/deletelist` `/appendlist` `/favorite` `/like` `/favorites`',
                    inline: false
                },
                {
                    name: '⚙️ Settings & Admin',
                    value: '`/settings` `/loop` `/autoplay` `/247` `/settc` `/setvc` `/setdjrole` `/queuetype` `/skipratio` `/maxduration` `/songinstatus` `/serversettings` `/forceremove`',
                    inline: false
                },
                { name: '🔧 Utility', value: '`/help` `/ping` `/debug` `/stats` `/lyrics`', inline: false }
            )
            .setFooter({ text: 'Use /help category:<name> for detailed usage of any section' });

        await ctx.write({ embeds: [helpEmbed] });
    }
}

