import {
    Command,
    Declare,
    Options,
    Embed,
    createStringOption,
    createIntegerOption,
    createNumberOption,
    createBooleanOption,
    createChannelOption,
    createRoleOption,
    createUserOption,
    type CommandContext
} from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { loadSettings, setSetting } from '../services/serverSettings.js';
import { isOwner, isDJ, djOnlyError, verifyVoiceConnection, PermissionFlagsBits } from '../utils/permissions.js';
import type { Song } from '../types.js';

function isAdmin(ctx: CommandContext): boolean {
    if (!ctx.member) return false;
    if (isOwner(ctx.member.id)) return true;
    if (ctx.member.permissions.has([PermissionFlagsBits.Administrator])) return true;
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
    async run(ctx: CommandContext<typeof forceRemoveOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!(await isDJ(ctx.member))) return djOnlyError(ctx);

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

        const prevNextSong = queue.songs[1];

        if (position) {
            const index = position - 1; // Position 1 is currently playing
            if (index < 1 || index >= queue.songs.length) {
                return ctx.write({
                    content: `❌ Invalid position. Queue only has ${queue.songs.length} tracks.`,
                    flags: 64
                });
            }
            const removed = queue.songs.splice(index, 1)[0];
            musicManager._cleanupSong(removed);

            if (queue.songs[1] !== prevNextSong && queue.songs.length > 1) {
                musicManager.prefetchNextTrack(ctx.guildId, queue.songs[1]);
            }

            return ctx.write({
                content: `🗑️ Force removed **${removed.title}** (requested by **${removed.requesterName || 'Unknown'}**)`
            });
        }

        if (user) {
            const toRemove: Song[] = [];
            for (let i = queue.songs.length - 1; i >= 1; i--) {
                if (queue.songs[i].requesterId === user.id) {
                    const [removed] = queue.songs.splice(i, 1);
                    musicManager._cleanupSong(removed);
                    toRemove.push(removed);
                }
            }
            if (toRemove.length === 0) {
                return ctx.write({ content: `❌ No tracks in queue from <@${user.id}>.`, flags: 64 });
            }

            if (queue.songs[1] !== prevNextSong && queue.songs.length > 1) {
                musicManager.prefetchNextTrack(ctx.guildId, queue.songs[1]);
            }

            return ctx.write({ content: `🗑️ Removed **${toRemove.length}** tracks added by <@${user.id}>.` });
        }
    }
}

// 2. Set TC Command
const setTcOptions = {
    channel: createChannelOption({
        description: 'Text channel (leave empty to allow all channels)',
        required: false
    })
};

@Declare({
    name: 'settc',
    description: 'Set the text channel for bot commands (Admin only)'
})
@Options(setTcOptions)
export class SetTcCommand extends Command {
    async run(ctx: CommandContext<typeof setTcOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const channel = ctx.options.channel;
        if (channel) {
            await setSetting(ctx.guildId, 'textChannelId', channel.id);
            return ctx.write({
                content: `✅ Bot will now only respond to commands in <#${channel.id}>.\n\n*Note: Commands in other channels will be rejected.*`
            });
        } else {
            await setSetting(ctx.guildId, 'textChannelId', null);
            return ctx.write({ content: '✅ Bot will respond to commands in any channel.' });
        }
    }
}

// 3. Set VC Command
const setVcOptions = {
    channel: createChannelOption({
        description: 'Voice channel (leave empty to allow all channels)',
        required: false
    })
};

@Declare({
    name: 'setvc',
    description: 'Set the voice channel lock for the bot (Admin only)'
})
@Options(setVcOptions)
export class SetVcCommand extends Command {
    async run(ctx: CommandContext<typeof setVcOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const channel = ctx.options.channel;
        if (channel) {
            await setSetting(ctx.guildId, 'voiceChannelId', channel.id);
            return ctx.write({
                content: `✅ Bot will only join <#${channel.id}>.\n\n*Note: Play commands from other voice channels will be rejected.*`
            });
        } else {
            await setSetting(ctx.guildId, 'voiceChannelId', null);
            return ctx.write({ content: '✅ Bot can join any voice channel.' });
        }
    }
}

// 4. Queue Type Command
const queueTypeOptions = {
    type: createStringOption({
        description: 'Queue type',
        required: true,
        choices: [
            { name: 'Linear (default) - Play in order added', value: 'linear' },
            { name: 'Fair - Alternate between users', value: 'fair' }
        ]
    })
};

@Declare({
    name: 'queuetype',
    description: 'Set the queue type (Admin only)'
})
@Options(queueTypeOptions)
export class QueueTypeCommand extends Command {
    async run(ctx: CommandContext<typeof queueTypeOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const type = ctx.options.type as 'linear' | 'fair';
        await setSetting(ctx.guildId, 'queueType', type);

        const description =
            type === 'fair'
                ? '🔄 **Fair Queue**: Bot will alternate between users, preventing one person from dominating the queue.'
                : '➡️ **Linear Queue**: Songs play in the order they were added.';

        return ctx.write({ content: `✅ Queue type set to **${type}**\n\n${description}` });
    }
}

// 5. Skip Ratio Command
const skipRatioOptions = {
    ratio: createNumberOption({
        description: 'Ratio of listeners needed to skip (0.0-1.0, leave empty for default)',
        required: false,
        min_value: 0.0,
        max_value: 1.0
    })
};

@Declare({
    name: 'skipratio',
    description: 'Set the vote skip ratio for this server (Admin only)'
})
@Options(skipRatioOptions)
export class SkipRatioCommand extends Command {
    async run(ctx: CommandContext<typeof skipRatioOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const ratio = ctx.options.ratio;
        if (ratio !== null && ratio !== undefined) {
            await setSetting(ctx.guildId, 'skipRatio', ratio);
            return ctx.write({
                content: `✅ Skip ratio set to **${(ratio * 100).toFixed(0)}%** of listeners needed to skip.`
            });
        } else {
            await setSetting(ctx.guildId, 'skipRatio', null);
            const defaultRatio = parseFloat(process.env.SKIP_RATIO || '0.5') || 0.5;
            return ctx.write({
                content: `✅ Skip ratio reset to global default (${(defaultRatio * 100).toFixed(0)}%).`
            });
        }
    }
}

// 6. Song In Status Command
const songInStatusOptions = {
    enabled: createBooleanOption({
        description: 'Enable song in status',
        required: true
    })
};

@Declare({
    name: 'songinstatus',
    description: 'Toggle showing current song in bot status (Admin only)'
})
@Options(songInStatusOptions)
export class SongInStatusCommand extends Command {
    async run(ctx: CommandContext<typeof songInStatusOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const enabled = ctx.options.enabled;
        await setSetting(ctx.guildId, 'songInStatus', enabled);
        await musicManager.updateStatus();

        if (enabled) {
            return ctx.write({ content: '✅ Bot status will now show the current song.' });
        } else {
            return ctx.write({ content: '✅ Bot status will no longer show the current song.' });
        }
    }
}

// 7. Max Duration Command
const maxDurationOptions = {
    seconds: createIntegerOption({
        description: 'Max duration in seconds (0 = unlimited)',
        required: true,
        min_value: 0,
        max_value: 86400
    })
};

@Declare({
    name: 'maxduration',
    description: 'Set maximum song duration in seconds (Admin only)'
})
@Options(maxDurationOptions)
export class MaxDurationCommand extends Command {
    async run(ctx: CommandContext<typeof maxDurationOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const seconds = ctx.options.seconds;
        if (seconds === 0) {
            await setSetting(ctx.guildId, 'maxDuration', null);
            return ctx.write({ content: '✅ Maximum song duration removed (unlimited).' });
        }

        await setSetting(ctx.guildId, 'maxDuration', seconds);
        const hours = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        const timeStr =
            hours > 0 ? `${hours}h ${mins}m ${secs}s` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        return ctx.write({
            content: `✅ Maximum song duration set to **${timeStr}**.\n\nSongs longer than this will be rejected.`
        });
    }
}

// 8. Set DJ Role Command
const setDjRoleOptions = {
    role: createRoleOption({
        description: 'DJ role (leave empty to clear)',
        required: false
    })
};

@Declare({
    name: 'setdjrole',
    description: 'Set the DJ role for this server (Admin only)'
})
@Options(setDjRoleOptions)
export class SetDjRoleCommand extends Command {
    async run(ctx: CommandContext<typeof setDjRoleOptions>): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const role = ctx.options.role;
        if (role) {
            await setSetting(ctx.guildId, 'djRoleId', role.id);
            return ctx.write({
                content: `✅ DJ role set to <@&${role.id}>.\n\nMembers with this role can use DJ-only commands.`
            });
        } else {
            await setSetting(ctx.guildId, 'djRoleId', null);
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
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        if (!isAdmin(ctx)) return ctx.write({ content: '🔒 This command requires Administrator permission.', flags: 64 });

        const settings = await loadSettings(ctx.guildId);

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
                    value:
                        settings.skipRatio != null
                            ? `${(settings.skipRatio * 100).toFixed(0)}%`
                            : `${((parseFloat(process.env.SKIP_RATIO || '0.5') || 0.5) * 100).toFixed(0)}% (default)`,
                    inline: true
                },
                {
                    name: '📊 Song in Status',
                    value: settings.songInStatus ? 'Enabled' : 'Disabled',
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
                },
                {
                    name: '⏱️ Max Duration',
                    value: settings.maxDuration ? `${settings.maxDuration}s` : 'Unlimited',
                    inline: true
                }
            ])
            .setFooter({ text: 'Use /settc, /setvc, /queuetype, /skipratio to change settings' });

        return ctx.write({ embeds: [embed] });
    }
}

