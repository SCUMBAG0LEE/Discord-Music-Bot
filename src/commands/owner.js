import { Command, Declare, Options, Embed, createStringOption, createBooleanOption, createAttachmentOption } from 'seyfert';
import fs from 'fs';
import os from 'os';
import child_process from 'child_process';
import util from 'util';
const execAsync = util.promisify(child_process.exec);
import { musicManager, ffmpegInfo, hardwareOptimization } from '../services/MusicManager.js';
import { isOwner, ownerOnlyError } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

// Helper to convert attachment or URL to base64 data URI
async function getBase64Image(imageUrl) {
    const res = await fetch(imageUrl);
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

// 1. Set Avatar Command
@Declare({
    name: 'setavatar',
    description: "Change the bot's avatar (Owner only)"
})
@Options({
    image: createAttachmentOption({
        description: 'New avatar image file',
        required: false
    }),
    url: createStringOption({
        description: 'Image URL',
        required: false
    })
})
export class SetAvatarCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const image = ctx.options.image;
        const url = ctx.options.url;
        const imageUrl = image?.url || url;

        if (!imageUrl) {
            return ctx.write({ content: '❌ Please provide an image attachment or URL.', flags: 64 });
        }

        try {
            await ctx.deferReply({ flags: 64 });
        } catch (e) {
            logger.warn('SetAvatarCommand', `Failed to defer interaction: ${e.message || e}`);
            return;
        }

        try {
            const base64 = await getBase64Image(imageUrl);
            await ctx.client.rest.users.editCurrentUser({ avatar: base64 });
            return ctx.editOrReply({ content: '✅ Avatar updated successfully!' });
        } catch (error) {
            logger.error('SetAvatarCommand', 'SetAvatar Error:', error);
            return ctx.editOrReply({ content: `❌ Failed to update avatar: ${error.message}` });
        }
    }
}

// 2. Set Banner Command
@Declare({
    name: 'setbanner',
    description: "Change the bot's banner (Owner only)"
})
@Options({
    image: createAttachmentOption({
        description: 'New banner image file',
        required: false
    }),
    url: createStringOption({
        description: 'Image URL',
        required: false
    }),
    remove: createBooleanOption({
        description: 'Remove current banner',
        required: false
    })
})
export class SetBannerCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const remove = ctx.options.remove;
        if (remove) {
            try {
                await ctx.deferReply({ flags: 64 });
            } catch (e) {
                logger.warn('SetBannerCommand', `Failed to defer interaction: ${e.message || e}`);
                return;
            }
            try {
                await ctx.client.rest.users.editCurrentUser({ banner: null });
                return ctx.editOrReply({ content: '✅ Banner removed!' });
            } catch (error) {
                logger.error('SetBannerCommand', 'SetBanner Error:', error);
                return ctx.editOrReply({ content: `❌ Failed to remove banner: ${error.message}` });
            }
        }

        const image = ctx.options.image;
        const url = ctx.options.url;
        const imageUrl = image?.url || url;

        if (!imageUrl) {
            return ctx.write({ content: '❌ Please provide an image attachment, URL, or set remove: true.', flags: 64 });
        }

        try {
            await ctx.deferReply({ flags: 64 });
        } catch (e) {
            logger.warn('SetBannerCommand', `Failed to defer interaction: ${e.message || e}`);
            return;
        }

        try {
            const base64 = await getBase64Image(imageUrl);
            await ctx.client.rest.users.editCurrentUser({ banner: base64 });
            return ctx.editOrReply({ content: '✅ Banner updated successfully!' });
        } catch (error) {
            logger.error('SetBannerCommand', 'SetBanner Error:', error);
            return ctx.editOrReply({ content: `❌ Failed to update banner: ${error.message}` });
        }
    }
}

// 3. Set Name Command
@Declare({
    name: 'setname',
    description: "Change the bot's username (Owner only)"
})
@Options({
    name: createStringOption({
        description: 'New username',
        required: true,
        min_length: 2,
        max_length: 32
    })
})
export class SetNameCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const name = ctx.options.name;
        try {
            await ctx.deferReply({ flags: 64 });
        } catch (e) {
            logger.warn('SetNameCommand', `Failed to defer interaction: ${e.message || e}`);
            return;
        }

        try {
            await ctx.client.rest.users.editCurrentUser({ username: name });
            return ctx.editOrReply({ content: `✅ Username changed to **${name}**` });
        } catch (error) {
            logger.error('SetNameCommand', 'SetName Error:', error);
            return ctx.editOrReply({ content: `❌ Failed to change username: ${error.message}` });
        }
    }
}

// 4. Set Status Command
@Declare({
    name: 'setstatus',
    description: "Change the bot's online presence status (Owner only)"
})
@Options({
    status: createStringOption({
        description: 'Online status',
        required: true,
        choices: [
            { name: '🟢 Online', value: 'online' },
            { name: '🟡 Idle', value: 'idle' },
            { name: '🔴 Do Not Disturb', value: 'dnd' },
            { name: '⚫ Invisible', value: 'invisible' }
        ]
    })
})
export class SetStatusCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const status = ctx.options.status;
        try {
            ctx.client.gateway.setPresence({
                status: status,
                activities: ctx.client.gateway.options.presence?.activities || []
            });
            return ctx.write({ content: `✅ Status set to **${status}**`, flags: 64 });
        } catch (error) {
            return ctx.write({ content: `❌ Failed to set status: ${error.message}`, flags: 64 });
        }
    }
}

// 5. Set Game Command
@Declare({
    name: 'setgame',
    description: "Change the bot's status activity (Owner only)"
})
@Options({
    type: createStringOption({
        description: 'Activity type',
        required: true,
        choices: [
            { name: '🎮 Playing', value: '0' },
            { name: '🟣 Streaming', value: '1' },
            { name: '🎧 Listening', value: '2' },
            { name: '📺 Watching', value: '3' },
            { name: '🏆 Competing', value: '5' },
            { name: '❌ None', value: 'NONE' }
        ]
    }),
    text: createStringOption({
        description: 'Activity text',
        required: false
    })
})
export class SetGameCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const type = ctx.options.type;
        const text = ctx.options.text || 'music';

        try {
            if (type === 'NONE') {
                ctx.client.gateway.setPresence({ activities: [] });
                return ctx.write({ content: '✅ Activity cleared', flags: 64 });
            }

            const activityType = parseInt(type);
            const activity = {
                name: text,
                type: activityType
            };

            // Inject Twitch URL for Streaming badge if configured
            if (activityType === 1) {
                activity.url = process.env.STREAMING_URL || 'https://twitch.tv/twitch';
            }

            ctx.client.gateway.setPresence({
                activities: [activity],
                status: ctx.client.gateway.options.presence?.status || 'online'
            });

            return ctx.write({ content: `✅ Activity set successfully to text **"${text}"**`, flags: 64 });
        } catch (error) {
            return ctx.write({ content: `❌ Failed to set activity: ${error.message}`, flags: 64 });
        }
    }
}

// 6. Shutdown Command
@Declare({
    name: 'shutdown',
    description: 'Shutdown the bot process (Owner only)'
})
export class ShutdownCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        await ctx.write({ content: '👋 Shutting down...', flags: 64 });

        // Disconnect voice channels and clean queues
        const queues = [...musicManager.queues.values()];
        for (const queue of queues) {
            try {
                if (queue.connection) {
                    queue.connection.destroy();
                }
            } catch (e) {
                // Ignore voice cleanup errors
            }
        }

        process.exit(0);
    }
}

// In-Memory Cache for Static Hardware Specs & Network IPs
let systemInfoStaticCache = null;
let networkIpCache = null;
let networkIpCacheTime = 0;

async function getStaticSystemSpecs() {
    if (systemInfoStaticCache) return systemInfoStaticCache;

    const cpus = os.cpus();
    let cpuModel = cpus[0]?.model?.trim();
    if (!cpuModel || cpuModel.toLowerCase() === 'unknown' || cpuModel === '') {
        try {
            if (fs.existsSync('/proc/cpuinfo')) {
                const cpuInfo = await fs.promises.readFile('/proc/cpuinfo', 'utf8');
                const match = cpuInfo.match(/model name\s*:\s*(.+)/i) || cpuInfo.match(/Hardware\s*:\s*(.+)/i);
                if (match && match[1]) cpuModel = match[1].trim();
            }
        } catch (e) {}
    }
    if (!cpuModel || cpuModel.toLowerCase() === 'unknown' || cpuModel === '') {
        try {
            if (os.type() === 'Linux') {
                const { stdout: lscpuOut } = await execAsync('lscpu', { timeout: 1000 });
                const match = lscpuOut.match(/Model name:\s*(.+)/i);
                if (match && match[1]) cpuModel = match[1].trim();
            }
        } catch (e) {}
    }
    if (!cpuModel || cpuModel.toLowerCase() === 'unknown' || cpuModel === '') {
        cpuModel = `${os.arch().toUpperCase()} Processor`;
    }

    const coreCount = cpus.length;
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);

    let osName = os.type();
    let kernelVersion = `${os.type()} ${os.release()}`;
    if (os.type() === 'Windows_NT') {
        osName = 'Windows';
        kernelVersion = `NT ${os.release()}`;
        const buildNum = parseInt(os.release().split('.')[2] || '0', 10);
        if (buildNum >= 22000) osName = 'Windows 11 / Server 2022+';
        else if (buildNum >= 10240) osName = 'Windows 10 / Server 2016+';
        else if (buildNum >= 9600) osName = 'Windows 8.1 / Server 2012 R2';
        else if (buildNum >= 9200) osName = 'Windows 8 / Server 2012';
        else if (buildNum >= 7600) osName = 'Windows 7 / Server 2008 R2';
        else osName = 'Windows Legacy';
    } else if (os.type() === 'Darwin') {
        osName = 'macOS';
        kernelVersion = `Darwin ${os.release()}`;
        try {
            if (fs.existsSync('/System/Library/CoreServices/SystemVersion.plist')) {
                const plist = await fs.promises.readFile('/System/Library/CoreServices/SystemVersion.plist', 'utf8');
                const match = plist.match(/<key>ProductVersion<\/key>\s*<string>([^<]+)<\/string>/i);
                if (match && match[1]) osName = `macOS ${match[1].trim()}`;
            }
        } catch (e) {}
    } else if (os.type() === 'Linux') {
        osName = 'Linux';
        kernelVersion = `Linux ${os.release()}`;
        try {
            const osReleasePath = fs.existsSync('/etc/os-release') 
                ? '/etc/os-release' 
                : (fs.existsSync('/usr/lib/os-release') ? '/usr/lib/os-release' : null);
            if (osReleasePath) {
                const releaseContent = await fs.promises.readFile(osReleasePath, 'utf8');
                const prettyMatch = releaseContent.match(/^PRETTY_NAME=["']?([^"\n\r]+)["']?/m);
                const nameMatch = releaseContent.match(/^NAME=["']?([^"\n\r]+)["']?/m);
                const matchedName = prettyMatch ? prettyMatch[1] : (nameMatch ? nameMatch[1] : null);
                if (matchedName) osName = matchedName.replace(/["']/g, '').trim();
            }
        } catch (e) {}
    }

    let osUsername = 'Unknown';
    try {
        const info = os.userInfo();
        if (info && info.username) osUsername = info.username;
    } catch (e) {
        osUsername = process.env.USER || process.env.USERNAME || 'Unknown';
    }

    let ytdlpVersion = 'Unknown';
    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
    try {
        const { stdout: out } = await execAsync(`"${ytdlpPath}" --version`, { timeout: 1000 });
        if (out) ytdlpVersion = out.trim();
    } catch (e) {}

    const userAgentStr = process.env.YOUTUBE_USER_AGENT || 'Default yt-dlp User-Agent';
    const poTokenStr = process.env.YOUTUBE_PO_TOKEN 
        ? `Active (${process.env.YOUTUBE_PO_TOKEN.substring(0, 15)}...)` 
        : 'Plugin / Auto-Generator Active';

    systemInfoStaticCache = {
        cpuModel,
        coreCount,
        totalMem,
        osName,
        kernelVersion,
        osUsername,
        ytdlpVersion,
        ytdlpPath,
        userAgentStr,
        poTokenStr
    };

    return systemInfoStaticCache;
}

// 7. System Info Command
@Declare({
    name: 'systeminfo',
    description: 'Show host server and bot runtime diagnostics (Owner only)'
})
export class SystemInfoCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        // Fetch static specs from cache (0ms)
        const staticSpecs = await getStaticSystemSpecs();

        const used = process.memoryUsage();
        const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
        
        const formatUptimeSec = (sec) => {
            const s = Math.floor(sec);
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            const rSec = s % 60;
            return `${d}d ${h}h ${m}m ${rSec}s`;
        };

        const botUptimeStr = formatUptimeSec(process.uptime());
        const serverUptimeStr = formatUptimeSec(os.uptime());

        const activeQueues = musicManager.queues.size;
        let totalQueuedTracks = 0;
        for (const q of musicManager.queues.values()) {
            if (q.songs) totalQueuedTracks += q.songs.length;
        }
        
        let guildCount = 0;
        try {
            const guilds = await ctx.client.cache.guilds?.values();
            if (guilds) guildCount = guilds.length;
        } catch (e) {}

        // Network IP Diagnostics with 5-minute TTL cache
        const now = Date.now();
        if (!networkIpCache || (now - networkIpCacheTime) > 5 * 60 * 1000) {
            let ipv4 = 'Fetch Failed';
            let ipv6 = 'N/A (No IPv6 route)';
            try {
                const res4 = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(2500) });
                ipv4 = (await res4.text()).trim().substring(0, 45);
            } catch (e) {}

            try {
                const res6 = await fetch('https://api6.ipify.org', { signal: AbortSignal.timeout(2500) });
                const text6 = (await res6.text()).trim().substring(0, 45);
                if (text6 && text6 !== ipv4) ipv6 = text6;
            } catch (e) {}

            const rawProxy = process.env.YOUTUBE_PROXY || '';
            const proxyStr = rawProxy 
                ? (rawProxy.length > 50 ? `${rawProxy.substring(0, 50)}...` : rawProxy) 
                : 'Direct Connection (No Proxy)';

            let proxyOutboundIpv4 = 'N/A';
            let proxyOutboundIpv6 = 'N/A (No IPv6 route)';
            if (rawProxy) {
                try {
                    const { stdout: out4 } = await execAsync(`curl -s -m 3 --proxy "${rawProxy}" https://api.ipify.org`, { timeout: 3000 });
                    if (out4) proxyOutboundIpv4 = out4.trim().substring(0, 45);
                } catch (e) {}

                try {
                    const { stdout: out6 } = await execAsync(`curl -s -m 3 --proxy "${rawProxy}" https://api6.ipify.org`, { timeout: 3000 });
                    if (out6) {
                        const clean6 = out6.trim().substring(0, 45);
                        if (clean6 !== proxyOutboundIpv4) proxyOutboundIpv6 = clean6;
                    }
                } catch (e) {}
            }

            networkIpCache = { ipv4, ipv6, rawProxy, proxyStr, proxyOutboundIpv4, proxyOutboundIpv6 };
            networkIpCacheTime = now;
        }

        const { ipv4, ipv6, rawProxy, proxyStr, proxyOutboundIpv4, proxyOutboundIpv6 } = networkIpCache;

        // Cookie diagnostics (inspected live so new cookie files show up immediately)
        let cookieStatus = 'Not Loaded';
        try {
            if (process.env.YOUTUBE_COOKIES) {
                const val = process.env.YOUTUBE_COOKIES.trim();
                const isB64 = !val.startsWith('#') && !val.startsWith('[');
                const lenKb = (Buffer.byteLength(val, 'utf8') / 1024).toFixed(1);
                cookieStatus = `Loaded from ENV (${lenKb} KB | ${isB64 ? 'Base64 Encoded' : 'Raw Text'})`;
            } else if (fs.existsSync('./youtube-cookies.txt')) {
                const stats = await fs.promises.stat('./youtube-cookies.txt');
                cookieStatus = `./youtube-cookies.txt (${(stats.size / 1024).toFixed(1)} KB | Netscape)`;
            } else if (fs.existsSync('./cookies.txt')) {
                const stats = await fs.promises.stat('./cookies.txt');
                cookieStatus = `./cookies.txt (${(stats.size / 1024).toFixed(1)} KB | Netscape)`;
            } else if (fs.existsSync('./youtube-cookies.json')) {
                const stats = await fs.promises.stat('./youtube-cookies.json');
                cookieStatus = `./youtube-cookies.json (${(stats.size / 1024).toFixed(1)} KB | JSON Auto-Convert)`;
            } else if (fs.existsSync('./cookies.json')) {
                const stats = await fs.promises.stat('./cookies.json');
                cookieStatus = `./cookies.json (${(stats.size / 1024).toFixed(1)} KB | JSON Auto-Convert)`;
            }
        } catch (e) {
            cookieStatus = 'Error Inspecting Cookie File';
        }

        let runtimeStr = `Node.js v${process.versions?.node || process.version}`;
        if (typeof Bun !== 'undefined') {
            runtimeStr = `Bun v${Bun.version}`;
        } else if (typeof Deno !== 'undefined') {
            runtimeStr = `Deno v${Deno.version?.deno || 'Unknown'}`;
        }

        const dbEngine = (process.env.CLOUDFLARE_D1_TOKEN && process.env.CLOUDFLARE_D1_DATABASE_ID) 
            ? 'Cloudflare D1 (Serverless SQLite)' 
            : 'Local bun:sqlite (WAL Mode)';

        const embed = new Embed()
            .setTitle('🔧 Owner Server & Bypass Diagnostics')
            .setColor('#FF6B6B')
            .addFields([
                { 
                    name: '🤖 Bot & Process', 
                    value: `> **Guilds:** \`${guildCount}\`\n> **Active Streams:** \`${activeQueues}\` (${totalQueuedTracks} queued)\n> **Bot Uptime:** \`${botUptimeStr}\`\n> **PID:** \`${process.pid}\`\n> **Shard:** \`${ctx.shardId ?? 0} / ${ctx.client.gateway?.totalShards ?? 1}\`\n> **OS User:** \`${staticSpecs.osUsername}\`\n> **Runtime:** \`${runtimeStr}\``, 
                    inline: true 
                },
                { 
                    name: '💾 Memory Usage', 
                    value: `> **Heap:** \`${(used.heapUsed / 1024 / 1024).toFixed(2)} MB\`\n> **RSS:** \`${(used.rss / 1024 / 1024).toFixed(2)} MB\`\n> **External:** \`${(used.external / 1024 / 1024).toFixed(2)} MB\``, 
                    inline: true 
                },
                { 
                    name: '📁 Database & Storage Settings', 
                    value: `> **Database:** \`${dbEngine}\`\n> **Storage:** \`${hardwareOptimization.diskType.toUpperCase()}\` | **Buffer:** \`${hardwareOptimization.bufferSizeMB} MB\` | **Threads:** \`${hardwareOptimization.threads}\``, 
                    inline: false 
                },
                { 
                    name: '🎵 Music Engine Binaries', 
                    value: `> **FFmpeg:** \`v${ffmpegInfo.version}\` (${ffmpegInfo.type})\n> **FFmpeg Path:** \`${ffmpegInfo.path}\`\n> **yt-dlp:** \`v${staticSpecs.ytdlpVersion}\`\n> **yt-dlp Path:** \`${staticSpecs.ytdlpPath}\``, 
                    inline: false 
                },
                { 
                    name: '🌐 Network & Proxy IP Addresses', 
                    value: rawProxy 
                        ? `> **Host IPv4:** \`${ipv4}\`\n> **Host IPv6:** \`${ipv6}\`\n> **Proxy Endpoint:** \`${proxyStr}\`\n> **Proxy Outbound IPv4:** \`${proxyOutboundIpv4}\`\n> **Proxy Outbound IPv6:** \`${proxyOutboundIpv6}\``
                        : `> **Host IPv4:** \`${ipv4}\`\n> **Host IPv6:** \`${ipv6}\`\n> **Proxy Route:** \`Direct Connection (No Proxy)\``, 
                    inline: false 
                },
                { 
                    name: '🔑 YouTube Bypass Configuration', 
                    value: `> **Cookies:** \`${cookieStatus}\`\n> **User-Agent:** \`${staticSpecs.userAgentStr}\`\n> **PoToken:** \`${staticSpecs.poTokenStr}\``, 
                    inline: false 
                },
                { 
                    name: '🖥️ Hardware Specs', 
                    value: `> **CPU:** \`${staticSpecs.cpuModel}\`\n> **Cores:** \`${staticSpecs.coreCount}\`\n> **RAM:** \`${freeMem} GB free / ${staticSpecs.totalMem} GB total\``, 
                    inline: false 
                },
                { 
                    name: '🐧 Platform & Kernel', 
                    value: `> **OS:** \`${staticSpecs.osName} (${os.arch()})\`\n> **Kernel:** \`${staticSpecs.kernelVersion}\`\n> **Host Server Uptime:** \`${serverUptimeStr}\``, 
                    inline: false 
                }
            ])
            .setTimestamp();

        return ctx.write({ embeds: [embed], flags: 64 });
    }
}

// 8. Eval Command
@Declare({
    name: 'eval',
    description: 'Evaluate JavaScript code strings (Owner only)'
})
@Options({
    code: createStringOption({
        description: 'Code to evaluate',
        required: true
    })
})
export class EvalCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const code = ctx.options.code;
        
        try {
            // eslint-disable-next-line no-eval
            let result = eval(code);
            
            if (result instanceof Promise) {
                result = await result;
            }
            
            let output = typeof result === 'string' 
                ? result 
                : (typeof Bun !== 'undefined' ? Bun.inspect(result, { depth: 1 }) : String(result));
            
            // Truncate if output exceeds Discord message bounds
            if (output.length > 1900) {
                output = output.substring(0, 1900) + '...';
            }
            
            // Hide token if exposed
            if (process.env.BOT_TOKEN) {
                output = output.replace(new RegExp(process.env.BOT_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[TOKEN]');
            }
            
            return ctx.write({ content: `\`\`\`js\n${output}\n\`\`\``, flags: 64 });
        } catch (error) {
            return ctx.write({ content: `❌ Error:\n\`\`\`\n${error.message}\n\`\`\``, flags: 64 });
        }
    }
}

// 9. Servers Command
@Declare({
    name: 'servers',
    description: 'List all servers the bot is in (Owner only)'
})
export class ServersCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        try {
            const guilds = await ctx.client.cache.guilds?.values() || [];
            const sorted = guilds
                .slice(0, 25)
                .map((g, i) => `${i + 1}. **${g.name}** (\`${g.id}\`)`);

            const embed = new Embed()
                .setTitle(`📊 Connected Servers (${guilds.length} total)`)
                .setDescription(sorted.join('\n') || 'No servers cached.')
                .setColor('#5865F2')
                .setTimestamp();

            return ctx.write({ embeds: [embed], flags: 64 });
        } catch (e) {
            return ctx.write({ content: `❌ Failed to fetch servers: ${e.message}`, flags: 64 });
        }
    }
}

// 10. Leave Server Command
@Declare({
    name: 'leaveserver',
    description: 'Instruct the bot to leave a server (Owner only)'
})
@Options({
    serverid: createStringOption({
        description: 'Guild ID to leave',
        required: true
    })
})
export class LeaveServerCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const serverId = ctx.options.serverid;
        
        try {
            await ctx.client.rest.guilds.leave(serverId);
            return ctx.write({ content: `✅ Successfully left server with ID **${serverId}**`, flags: 64 });
        } catch (error) {
            return ctx.write({ content: `❌ Failed to leave server: ${error.message}`, flags: 64 });
        }
    }
}

