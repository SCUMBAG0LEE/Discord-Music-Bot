import { Client } from 'seyfert';
import { logger } from './utils/logger.js';
import { musicManager, voiceAdapters } from './services/MusicManager.js';
import dns from 'dns';

// Keep DNS cache warm for Discord API to prevent interaction timeouts on slow networks
const warmDns = () => {
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
setInterval(warmDns, 20000);

const client = new Client({
    allowedMentions: { parse: ['users'] }
});

// Give MusicManager access to the client to update presence
musicManager.client = client;

// Patch Seyfert's Command Loader to support multiple named exports per file
client.commands.onFile = (file) => {
    if (Array.isArray(file.default)) return file.default;
    if (file.default) return [file.default];
    return Object.values(file).filter(x => typeof x === 'function');
};

client.start().then(async () => {
    logger.info('Bot', 'Seyfert Music Bot Started successfully!');
    
    try {
        await client.uploadCommands();
        logger.info('Bot', 'Commands synced with Discord!');
    } catch (err) {
        logger.error('Bot', 'Upload Commands Failed');
        console.error(JSON.stringify(err, null, 2));
        throw err;
    }

    // Inject Raw Payload Interceptor for @discordjs/voice
    const originalHandlePayload = client.gateway.options.handlePayload;
    const wrapper = (shardId, packet) => {
        if (packet.t === 'VOICE_STATE_UPDATE') {
            const adapter = voiceAdapters.get(packet.d.guild_id);
            const botId = client.botId || client.me?.id;
            
            if (adapter && packet.d.user_id === botId) {
                adapter.onVoiceStateUpdate(packet.d);
            }
            
            // Check if VC is empty when a user leaves or moves
            if (packet.d.user_id !== botId) {
                const queue = musicManager.getQueue(packet.d.guild_id);
                if (queue && queue.voiceChannelId) {
                    setTimeout(async () => {
                        try {
                            const cachedStates = await client.cache.voiceStates?.values(packet.d.guild_id);
                            if (cachedStates) {
                                let membersInVc = 0;
                                for (const state of cachedStates) {
                                    if (state.channelId === queue.voiceChannelId && state.userId !== botId) {
                                        membersInVc++;
                                    }
                                }
                                
                                if (membersInVc === 0 && !queue.stay247) {
                                    await musicManager.sendMessage(queue, { content: '👋 Everyone left the voice channel! Stopping music to save resources...' });
                                    musicManager.leave(packet.d.guild_id);
                                }
                            }
                        } catch (e) {
                            console.error("Alone Check Error:", e);
                        }
                    }, 3000); // 3-second buffer to allow cache updates and quick reconnects
                }
            }
        } else if (packet.t === 'VOICE_SERVER_UPDATE') {
            // Forward server updates directly to the voice adapter
            const adapter = voiceAdapters.get(packet.d.guild_id);
            if (adapter) {
                adapter.onVoiceServerUpdate(packet.d);
            }
        }
        return originalHandlePayload.call(client.gateway.options, shardId, packet);
    };

    client.gateway.options.handlePayload = wrapper;
    for (const shard of client.gateway.values()) {
        shard.options.handlePayload = wrapper;
    }

    // Set Bot Presence
    let activityType = 0; // Default is Playing
    const typeStr = process.env.ACTIVITY_TYPE?.toUpperCase();
    if (typeStr === 'PLAYING') activityType = 0;
    if (typeStr === 'STREAMING') activityType = 1;
    if (typeStr === 'LISTENING') activityType = 2;
    if (typeStr === 'WATCHING') activityType = 3;
    if (typeStr === 'CUSTOM') activityType = 4;
    if (typeStr === 'COMPETING') activityType = 5;

    // Iterate over all shards and set presence
    client.gateway.setPresence({
        since: null,
        afk: false,
        status: process.env.BOT_STATUS || 'online',
        activities: [{
            name: process.env.ACTIVITY_NAME || 'music',
            type: activityType,
            url: process.env.STREAMING_URL || undefined
        }]
    });
}).catch((err) => {
    logger.error('Bot', 'Failed to start Seyfert', err);
});
