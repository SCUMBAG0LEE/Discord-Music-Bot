import { Command, Declare, Embed, Options, createStringOption } from 'seyfert';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { musicManager, ffmpegInfo, hardwareOptimization } from '../services/MusicManager.js';
import { getVoiceConnection } from '@discordjs/voice';

const execFileAsync = promisify(execFile);

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

        const embed = new Embed()
            .setTitle('🏓 Pong!')
            .setColor('#00FF00')
            .addFields(
                { name: 'Bot Latency', value: `${latency}ms`, inline: true },
                { name: 'Websocket Ping', value: `${wsPing}ms`, inline: true },
                { name: 'API Time', value: `${Date.now() - start}ms`, inline: true }
            );

        await ctx.editOrReply({ embeds: [embed] });
    }
}

@Declare({
    name: 'stats',
    description: 'Show bot statistics'
})
export class StatsCommand extends Command {
    async run(ctx) {
        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[StatsCommand] Failed to defer:`, e.message || e);
            return;
        }

        const uptime = formatDuration(Math.floor(process.uptime()));
        const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
        
        let ytdlpVersion = 'Unknown';
        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const { stdout } = await execFileAsync(ytdlpPath, ['--version']);
            ytdlpVersion = stdout.trim();
        } catch(e) {
            ytdlpVersion = 'Error';
        }

        const embed = new Embed()
            .setTitle('📊 Bot Statistics')
            .setColor('#5865F2')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '💾 Memory', value: `${memUsage} MB`, inline: true },
                { name: '📡 Runtime', value: typeof Bun !== 'undefined' ? `Bun v${Bun.version}` : `Node ${process.version}`, inline: true },
                { name: '💻 Platform', value: `${os.platform()} ${os.arch()}`, inline: true },
                { name: '🎵 FFmpeg', value: `${ffmpegInfo.type}\n(v${ffmpegInfo.version})`, inline: true },
                { name: '📥 yt-dlp', value: `v${ytdlpVersion}`, inline: true }
            )
            .setFooter({ text: 'Powered by Seyfert' });

        await ctx.editOrReply({ embeds: [embed] });
    }
}

@Declare({
    name: 'debug',
    description: 'Show advanced debugging information for the music player'
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

        let debugInfo = `**Shard ID:** ${ctx.shardId}\n`;
        debugInfo += `**Gateway Ping:** ${ctx.client.gateway.latency}ms\n\n`;
        
        debugInfo += `**FFmpeg Path:** \`${ffmpegInfo.path}\`\n**FFmpeg Version:** \`${ffmpegInfo.version}\`\n`;

        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const { stdout } = await execFileAsync(ytdlpPath, ['--version']);
            debugInfo += `**yt-dlp Path:** \`${ytdlpPath}\`\n**yt-dlp Version:** \`${stdout.trim()}\`\n\n`;
        } catch(e) {
            debugInfo += `**yt-dlp Path:** \`${process.env.YTDLP_PATH || 'yt-dlp'}\`\n**yt-dlp Version:** \`Error/Not Found\`\n\n`;
        }
        
        debugInfo += `**Hardware Optimization:**\n`;
        debugInfo += `> **Threads:** \`${hardwareOptimization.threads}\`\n`;
        debugInfo += `> **Buffer:** \`${hardwareOptimization.bufferSizeMB} MB\`\n`;
        debugInfo += `> **Disk Type:** \`${hardwareOptimization.diskType.toUpperCase()}\`\n\n`;

        if (queue && connection) {
            debugInfo += `**Voice Connection:** ${connection.state.status}\n`;
            debugInfo += `**Audio Player:** ${queue.player.state.status}\n`;
            debugInfo += `**Queue Length:** ${queue.songs.length}\n`;
            debugInfo += `**Now Playing:** ${queue.playing ? 'Yes' : 'No'}\n`;
            debugInfo += `**Paused:** ${queue.paused ? 'Yes' : 'No'}\n`;
            debugInfo += `**Process Stream:** ${queue.ytdlpProcess ? 'Active' : 'None'}\n`;
            debugInfo += `**Resource:** ${queue.resource ? 'Active' : 'None'}\n`;
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

        if (category) {
            // simplified category help
            const embed = new Embed().setColor('#5865F2').setTitle(`${category.toUpperCase()} Commands`);
            await ctx.write({ embeds: [embed] });
            return;
        }

        const helpEmbed = new Embed()
            .setColor('#5865F2')
            .setTitle('🎵 Music Bot Commands')
            .addFields(
                { name: '🎶 Playing Music', value: '`/play` `/search` `/lyrics`', inline: true },
                { name: '⏯️ Playback Control', value: '`/pause` `/resume` `/stop` `/volume`', inline: true },
                { name: '📋 Queue', value: '`/queue` `/nowplaying` `/shuffle` `/clear` `/remove` `/move` `/jump`', inline: true },
                { name: '🔧 Utility', value: '`/help` `/ping` `/stats`', inline: true }
            )
            .setFooter({ text: 'Powered by Seyfert' });

        await ctx.write({ embeds: [helpEmbed] });
    }
}
