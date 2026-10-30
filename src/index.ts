import './types.js';
import { Client, Command, SubCommand } from 'seyfert';
import * as davey from '@snazzah/davey';
import dns from 'dns';
import { logger } from './utils/logger.js';
import { musicManager, voiceAdapters } from './services/MusicManager.js';
import { loadSettings } from './services/serverSettings.js';

// Enable @snazzah/davey unencrypted passthrough on startup
if (typeof (davey as any).setPassthrough === 'function') {
    (davey as any).setPassthrough(true);
}

// Keep DNS cache warm for Discord API to prevent interaction timeouts on slow networks
const warmDns = (): void => {
    dns.lookup('discord.com', (err) => {
        if (err && err.code !== 'ENOTFOUND') {
            logger.error('DNS', 'Failed to pre-resolve discord.com', err);
        }
    });
    dns.lookup('gateway.discord.gg', (err) => {
        if (err && err.code !== 'ENOTFOUND') {
            logger.error('DNS', 'Failed to pre-resolve gateway.discord.gg', err);
        }
    });
};
warmDns();
const dnsWarmInterval = setInterval(warmDns, 20000);
if (dnsWarmInterval.unref) dnsWarmInterval.unref();

// Global process error safety guards
process.on('unhandledRejection', (reason) => {
    logger.error('System', 'Unhandled Promise Rejection', reason);
});

process.on('uncaughtException', (error) => {
    logger.error('System', 'Uncaught Exception', error);
});

const client = new Client({
    allowedMentions: { parse: ['users'] }
});

// Give MusicManager access to the client to update presence
musicManager.client = client;

// Patch Seyfert's Command Loader to collect all top-level Command classes (excluding SubCommand)
client.commands.onFile = (file: Record<string, unknown>) => {
    const commands = new Set<new () => Command>();
    for (const val of Object.values(file)) {
        if (Array.isArray(val)) {
            for (const item of val) {
                if (
                    typeof item === 'function' &&
                    item.prototype instanceof Command &&
                    !(item.prototype instanceof SubCommand)
                ) {
                    commands.add(item as new () => Command);
                }
            }
        } else if (
            typeof val === 'function' &&
            val.prototype instanceof Command &&
            !(val.prototype instanceof SubCommand)
        ) {
            commands.add(val as new () => Command);
        }
    }
    return [...commands];
};

// Track per-guild voice state debounce timers
const voiceCheckDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function countHumanMembersInVc(guildId: string, channelId: string, botId?: string): Promise<number> {
    const voiceStates = await client.cache.voiceStates?.values(guildId);
    let membersInVc = 0;
    if (voiceStates) {
        for (const state of voiceStates) {
            if (state.channelId === channelId && state.userId !== botId) {
                const userObj = await client.cache.users?.get(state.userId);
                if (userObj?.bot) continue;
                membersInVc++;
            }
        }
    }
    return membersInVc;
}

client.start().then(async () => {
    logger.info('Bot', 'Seyfert Music Bot Started successfully!');

    if (process.env.SKIP_COMMAND_UPLOAD !== 'true') {
        try {
            await client.uploadCommands();
            logger.info('Bot', 'Commands synced with Discord!');
        } catch (err) {
            logger.error('Bot', 'Upload Commands Failed', err);
            throw err;
        }
    } else {
        logger.info('Bot', 'Skipping command upload (SKIP_COMMAND_UPLOAD=true)');
    }

    // Inject Raw Payload Interceptor for @discordjs/voice
    const originalHandlePayload = client.gateway.options.handlePayload;
    const wrapper = async (shardId: number, packet: any) => {
        // Call Seyfert's internal payload handler FIRST so voiceStates cache is updated before we inspect it
        const result = await originalHandlePayload?.call(client.gateway.options, shardId, packet);

        if (packet.t === 'VOICE_STATE_UPDATE') {
            const adapter = voiceAdapters.get(packet.d.guild_id);
            const botId = client.botId || client.me?.id;
            const { guild_id, user_id, channel_id } = packet.d;

            if (user_id === botId) {
                if (adapter) adapter.onVoiceStateUpdate(packet.d);
                const queue = musicManager.getQueue(guild_id);
                if (queue) {
                    if (channel_id) {
                        queue.voiceChannelId = channel_id;
                    } else {
                        logger.info('Voice', `Bot was disconnected from VC by admin in guild ${guild_id}`);
                        const existingDebounce = voiceCheckDebounceTimers.get(guild_id);
                        if (existingDebounce) {
                            clearTimeout(existingDebounce);
                            voiceCheckDebounceTimers.delete(guild_id);
                        }
                        if (queue.emptyVcTimeout) clearTimeout(queue.emptyVcTimeout);
                        musicManager.leave(guild_id);
                    }
                }
            }

            if (user_id !== botId) {
                const queue = musicManager.getQueue(guild_id);
                if (queue && queue.voiceChannelId) {
                    const existingDebounce = voiceCheckDebounceTimers.get(guild_id);
                    if (existingDebounce) {
                        clearTimeout(existingDebounce);
                    }

                    const debounceTimer = setTimeout(async () => {
                        voiceCheckDebounceTimers.delete(guild_id);
                        try {
                            const currentQueue = musicManager.getQueue(guild_id);
                            if (!currentQueue || !currentQueue.voiceChannelId) return;

                            const membersInVc = await countHumanMembersInVc(
                                guild_id,
                                currentQueue.voiceChannelId,
                                botId
                            );

                            if (membersInVc > 0) {
                                if (currentQueue.emptyVcTimeout) {
                                    clearTimeout(currentQueue.emptyVcTimeout);
                                    currentQueue.emptyVcTimeout = null;
                                }
                            } else {
                                if (currentQueue.emptyVcTimeout) clearTimeout(currentQueue.emptyVcTimeout);

                                const emptyGraceMs = process.env.IDLE_TIMEOUT
                                    ? Math.max(1000, parseInt(process.env.IDLE_TIMEOUT, 10) * 1000)
                                    : 15000;

                                currentQueue.emptyVcTimeout = setTimeout(async () => {
                                    try {
                                        const activeQueue = musicManager.getQueue(guild_id);
                                        if (!activeQueue || !activeQueue.voiceChannelId) return;

                                        const remainingHumans = await countHumanMembersInVc(
                                            guild_id,
                                            activeQueue.voiceChannelId,
                                            botId
                                        );
                                        const settings = await loadSettings(guild_id);
                                        const stay247 = Boolean(activeQueue.stay247 || settings.stayInChannel);

                                        if (remainingHumans === 0 && !stay247) {
                                            await musicManager.sendMessage(activeQueue, {
                                                content:
                                                    '👋 Everyone left the voice channel! Stopping music to save resources...'
                                            });
                                            musicManager.leave(guild_id);
                                        }
                                    } catch (e) {
                                        logger.error('VoiceCheck', 'Alone Check Error', e);
                                    }
                                }, emptyGraceMs);
                            }
                        } catch (e) {
                            logger.error('VoiceCheck', 'State Cache Error', e);
                        }
                    }, 500);

                    voiceCheckDebounceTimers.set(guild_id, debounceTimer);
                }
            }
        } else if (packet.t === 'VOICE_SERVER_UPDATE') {
            const adapter = voiceAdapters.get(packet.d.guild_id);
            if (adapter) {
                adapter.onVoiceServerUpdate(packet.d);
            }
        }

        return result;
    };

    client.gateway.options.handlePayload = wrapper;
    for (const shard of client.gateway.values()) {
        shard.options.handlePayload = wrapper;
    }

    // Set Bot Presence
    let activityType = 0;
    const typeStr = process.env.ACTIVITY_TYPE?.toUpperCase();
    if (typeStr === 'PLAYING') activityType = 0;
    if (typeStr === 'STREAMING') activityType = 1;
    if (typeStr === 'LISTENING') activityType = 2;
    if (typeStr === 'WATCHING') activityType = 3;
    if (typeStr === 'CUSTOM') activityType = 4;
    if (typeStr === 'COMPETING') activityType = 5;

    client.gateway.setPresence({
        since: null,
        afk: false,
        status: (process.env.BOT_STATUS as any) || 'online',
        activities: [
            {
                name: process.env.ACTIVITY_NAME || 'music',
                type: activityType,
                url: process.env.STREAMING_URL || undefined
            }
        ]
    });
}).catch((err) => {
    logger.error('Bot', 'Failed to start Seyfert', err);
});

process.on('SIGINT', () => clearInterval(dnsWarmInterval));
process.on('SIGTERM', () => clearInterval(dnsWarmInterval));
