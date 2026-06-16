import { Command, Declare, Options, Embed, createStringOption, createIntegerOption, createNumberOption, createBooleanOption, createChannelOption, createRoleOption, createUserOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { loadSettings, setSetting } from '../services/serverSettings.js';
import { isOwner, isDJ, djOnlyError, verifyVoiceConnection } from '../utils/permissions.js';

// Helper to check Administrator permissions or owner
function isAdmin(ctx) {
    if (isOwner(ctx.member.id)) return true;
    if (ctx.member.permissions.has('Administrator')) return true;
    return false;
}

// 1. Force Remove Command
const forceRemoveOptions = {
    position: createIntegerOption({
        description: 'Remove track at specific position (2+)',
        required: false,
        min_value: 2
    }),
    user: createUserOption({
        description: 'Remove all tracks added by this user',
        required: false
    })
};

@Declare({
    name: 'forceremove',
    description: 'Remove tracks from queue by position or user (DJ only)'
})
@Options(forceRemoveOptions)
export class ForceRemoveCommand extends Command {
    async run(ctx) {
        if (!isDJ(ctx.member)) return djOnlyError(ctx);

        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue || queue.songs.length <= 1) {
            return ctx.write({ content: '❌ The queue is empty or has only one song playing.', flags: 64 });
        }

        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        const position = ctx.options.position;
        const user = ctx.options.user;

        if (!position && !user) {
            return ctx.write({ content: '❌ You must specify either a position or a user to remove.', flags: 64 });
        }

        if (position) {
            const index = position - 1; // Position 1 is currently playing
            if (index >= queue.songs.length) {
                return ctx.write({ content: `❌ Invalid position. Queue only has ${queue.songs.length} tracks.`, flags: 64 });
            }
            const removed = queue.songs.splice(index, 1)[0];
            return ctx.write({ content: `🗑️ Force removed **${removed.title}** (requested by **${removed.requesterName || 'Unknown'}**)` });
        }

        if (user) {
            const toRemove = [];
            for (let i = queue.songs.length - 1; i >= 1; i--) {
                if (queue.songs[i].requesterId === user.id) {
                    toRemove.push(queue.songs.splice(i, 1)[0]);
                }
            }
            if (toRemove.length === 0) {
                return ctx.write({ content: `❌ No tracks in queue from <@${user.id}>.`, flags: 64 });
            }
            return ctx.write({ content: `🗑️ Removed **${toRemove.length}** tracks added by <@${user.id}>.` });
        }
    }
}

// 2. Set TC Command
@Declare({
    name: 'settc',
    description: 'Set the text channel for bot commands (Admin only)'
})
@Options({
    channel: createChannelOption({
        description: 'Text channel (leave empty to allow all channels)',
        required: false
    })
})
export class SetTcCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const channel = ctx.options.channel;
        if (channel) {
            setSetting(ctx.guildId, 'textChannelId', channel.id);
            return ctx.write({ content: `✅ Bot will now only respond to commands in <#${channel.id}>.\n\n*Note: Commands in other channels will be ignored.*` });
        } else {
            setSetting(ctx.guildId, 'textChannelId', null);
            return ctx.write({ content: '✅ Bot will respond to commands in any channel.' });
        }
    }
}

// 3. Set VC Command
@Declare({
    name: 'setvc',
    description: 'Set the voice channel lock for the bot (Admin only)'
})
@Options({
    channel: createChannelOption({
        description: 'Voice channel (leave empty to allow all channels)',
        required: false
    })
})
export class SetVcCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const channel = ctx.options.channel;
        if (channel) {
            setSetting(ctx.guildId, 'voiceChannelId', channel.id);
            return ctx.write({ content: `✅ Bot will only join <#${channel.id}>.\n\n*Note: Play commands from other voice channels will be rejected.*` });
        } else {
            setSetting(ctx.guildId, 'voiceChannelId', null);
            return ctx.write({ content: '✅ Bot can join any voice channel.' });
        }
    }
}

// 4. Queue Type Command
@Declare({
    name: 'queuetype',
    description: 'Set the queue type (Admin only)'
})
@Options({
    type: createStringOption({
        description: 'Queue type',
        required: true,
        choices: [
            { name: 'Linear (default) - Play in order added', value: 'linear' },
            { name: 'Fair - Alternate between users', value: 'fair' }
        ]
    })
})
export class QueueTypeCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const type = ctx.options.type;
        setSetting(ctx.guildId, 'queueType', type);
        
        const description = type === 'fair'
            ? '🔄 **Fair Queue**: Bot will alternate between users, preventing one person from dominating the queue.'
            : '➡️ **Linear Queue**: Songs play in the order they were added.';
            
        return ctx.write({ content: `✅ Queue type set to **${type}**\n\n${description}` });
    }
}

// 5. Skip Ratio Command
@Declare({
    name: 'skipratio',
    description: 'Set the vote skip ratio for this server (Admin only)'
})
@Options({
    ratio: createNumberOption({
        description: 'Ratio of listeners needed to skip (0.0-1.0, leave empty for default)',
        required: false,
        min_value: 0.0,
        max_value: 1.0
    })
})
export class SkipRatioCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const ratio = ctx.options.ratio;
        if (ratio !== null && ratio !== undefined) {
            setSetting(ctx.guildId, 'skipRatio', ratio);
            return ctx.write({ content: `✅ Skip ratio set to **${(ratio * 100).toFixed(0)}%** of listeners needed to skip.` });
        } else {
            setSetting(ctx.guildId, 'skipRatio', null);
            const defaultRatio = parseFloat(process.env.SKIP_RATIO) || 0.5;
            return ctx.write({ content: `✅ Skip ratio reset to global default (${(defaultRatio * 100).toFixed(0)}%).` });
        }
    }
}

// 6. Song In Status Command
@Declare({
    name: 'songinstatus',
    description: 'Toggle showing current song in bot status (Admin only)'
})
@Options({
    enabled: createBooleanOption({
        description: 'Enable song in status',
        required: true
    })
})
export class SongInStatusCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const enabled = ctx.options.enabled;
        setSetting(ctx.guildId, 'songInStatus', enabled);
        
        if (enabled) {
            return ctx.write({ content: '✅ Bot status will now show the current song.' });
        } else {
            return ctx.write({ content: '✅ Bot status will no longer show the current song.' });
        }
    }
}

// 7. Max Duration Command
@Declare({
    name: 'maxduration',
    description: 'Set maximum song duration in seconds (Admin only)'
})
@Options({
    seconds: createIntegerOption({
        description: 'Max duration in seconds (0 = unlimited)',
        required: true,
        min_value: 0,
        max_value: 86400
    })
})
export class MaxDurationCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const seconds = ctx.options.seconds;
        if (seconds === 0) {
            setSetting(ctx.guildId, 'maxDuration', null);
            return ctx.write({ content: '✅ Maximum song duration removed (unlimited).' });
        }
        
        setSetting(ctx.guildId, 'maxDuration', seconds);
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const timeStr = hours > 0
            ? `${hours}h ${mins}m ${secs}s`
            : mins > 0
                ? `${mins}m ${secs}s`
                : `${secs}s`;
                
        return ctx.write({ content: `✅ Maximum song duration set to **${timeStr}**.\n\nSongs longer than this will be rejected.` });
    }
}

// 8. Set DJ Role Command
@Declare({
    name: 'setdjrole',
    description: 'Set the DJ role for this server (Admin only)'
})
@Options({
    role: createRoleOption({
        description: 'DJ role (leave empty to clear)',
        required: false
    })
})
export class SetDjRoleCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const role = ctx.options.role;
        if (role) {
            setSetting(ctx.guildId, 'djRoleId', role.id);
            return ctx.write({ content: `✅ DJ role set to <@&${role.id}>.\n\nMembers with this role can use DJ-only commands.` });
        } else {
            setSetting(ctx.guildId, 'djRoleId', null);
            return ctx.write({ content: '✅ DJ role cleared. Only administrators can use DJ commands now.' });
        }
    }
}

// 9. Server Settings Command
@Declare({
    name: 'serversettings',
    description: 'View all server settings (Admin only)'
})
export class ServerSettingsCommand extends Command {
    async run(ctx) {
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });
        
        const settings = loadSettings(ctx.guildId);
        
        const embed = new Embed()
            .setTitle('⚙️ Server Settings')
            .setColor('#5865F2')
            .addFields([
                { 
                    name: '📝 Text Channel', 
                    value: settings.textChannelId ? `<#${settings.textChannelId}>` : 'Any channel',
                    inline: true 
                },
                { 
                    name: '🔊 Voice Channel', 
                    value: settings.voiceChannelId ? `<#${settings.voiceChannelId}>` : 'Any channel',
                    inline: true 
                },
                { 
                    name: '📋 Queue Type', 
                    value: settings.queueType || 'linear',
                    inline: true 
                },
                { 
                    name: '⏭️ Skip Ratio', 
                    value: settings.skipRatio != null 
                        ? `${(settings.skipRatio * 100).toFixed(0)}%` 
                        : `${((parseFloat(process.env.SKIP_RATIO) || 0.5) * 100).toFixed(0)}% (default)`,
                    inline: true 
                },
                { 
                    name: '📊 Song in Status', 
                    value: settings.songInStatus ? 'Enabled' : 'Disabled',
                    inline: true 
                },
                { 
                    name: '🔊 Default Volume', 
                    value: `${settings.defaultVolume || process.env.DEFAULT_VOLUME || 50}%`,
                    inline: true 
                },
                { 
                    name: '🎭 DJ Role', 
                    value: settings.djRoleId ? `<@&${settings.djRoleId}>` : 'Not set',
                    inline: true 
                },
                { 
                    name: '📻 24/7 Mode', 
                    value: settings.stayInChannel ? 'Enabled' : 'Disabled',
                    inline: true 
                }
            ])
            .setFooter({ text: 'Use /settc, /setvc, /queuetype, /skipratio to change settings' });

        return ctx.write({ embeds: [embed] });
    }
}
