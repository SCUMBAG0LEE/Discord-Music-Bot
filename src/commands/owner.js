import { Command, Declare, Options, Embed, createStringOption, createBooleanOption, createAttachmentOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { isOwner, ownerOnlyError } from '../utils/permissions.js';

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
            console.warn(`[SetAvatarCommand] Failed to defer interaction:`, e.message || e);
            return;
        }

        try {
            const base64 = await getBase64Image(imageUrl);
            await ctx.client.rest.users.editCurrentUser({ avatar: base64 });
            return ctx.editOrReply({ content: '✅ Avatar updated successfully!' });
        } catch (error) {
            console.error('SetAvatar Error:', error);
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
                console.warn(`[SetBannerCommand] Failed to defer interaction:`, e.message || e);
                return;
            }
            try {
                await ctx.client.rest.users.editCurrentUser({ banner: null });
                return ctx.editOrReply({ content: '✅ Banner removed!' });
            } catch (error) {
                console.error('SetBanner Error:', error);
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
            console.warn(`[SetBannerCommand] Failed to defer interaction:`, e.message || e);
            return;
        }

        try {
            const base64 = await getBase64Image(imageUrl);
            await ctx.client.rest.users.editCurrentUser({ banner: base64 });
            return ctx.editOrReply({ content: '✅ Banner updated successfully!' });
        } catch (error) {
            console.error('SetBanner Error:', error);
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
            console.warn(`[SetNameCommand] Failed to defer interaction:`, e.message || e);
            return;
        }

        try {
            await ctx.client.rest.users.editCurrentUser({ username: name });
            return ctx.editOrReply({ content: `✅ Username changed to **${name}**` });
        } catch (error) {
            console.error('SetName Error:', error);
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

// 7. Debug Command
@Declare({
    name: 'systemdebug',
    description: 'Show bot runtime diagnostics (Owner only)'
})
export class SystemDebugCommand extends Command {
    async run(ctx) {
        if (!isOwner(ctx.member.id)) return ownerOnlyError(ctx);

        const used = process.memoryUsage();
        const uptime = Math.floor(process.uptime());
        const days = Math.floor(uptime / 86400);
        const hours = Math.floor((uptime % 86400) / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        const uptimeStr = `${days}d ${hours}h ${mins}m ${secs}s`;

        const activeQueues = musicManager.queues.size;
        
        let guildCount = 0;
        try {
            const guilds = await ctx.client.cache.guilds?.values();
            if (guilds) guildCount = guilds.length;
        } catch (e) {}

        let systemIp = 'Fetch Failed';
        try {
            // Use api.ipify.org as it strictly returns raw text, and truncate to prevent 1024 char embed limit crashes
            const res = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
            const rawText = await res.text();
            systemIp = rawText.trim().substring(0, 50);
        } catch(e) {}

        const embed = new Embed()
            .setTitle('🔧 Bot Diagnostics')
            .setColor('#FF6B6B')
            .addFields([
                { 
                    name: '🤖 Bot Status', 
                    value: `Guilds: ${guildCount}\nUptime: ${uptimeStr}`, 
                    inline: true 
                },
                { 
                    name: '💾 Memory Usage', 
                    value: `Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB\nRSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`, 
                    inline: true 
                },
                { 
                    name: '🎵 Playback status', 
                    value: `Active Queues: ${activeQueues}`, 
                    inline: true 
                },
                { 
                    name: '🌐 Network', 
                    value: `System IP: \`${systemIp}\``, 
                    inline: true 
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

