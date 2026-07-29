import { Command, Declare } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { getVoiceConnection } from '@discordjs/voice';
import { verifyVoiceConnection } from '../utils/permissions.js';

@Declare({
    name: 'disconnect',
    description: 'Disconnect the bot from the voice channel and clear the queue'
})
export class DisconnectCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        const connection = getVoiceConnection(ctx.guildId);
        
        if (!queue && !connection) {
            return ctx.write({ content: 'There is no music playing and the bot is not in a voice channel.', flags: 64 });
        }
        
        // Ensure user is in the same voice channel as the bot (even if queue is null)
        const mockQueue = queue || { voiceChannelId: connection?.joinConfig?.channelId };
        const voiceChannelId = await verifyVoiceConnection(ctx, mockQueue, false);
        if (!voiceChannelId) return;
        
        musicManager.leave(ctx.guildId);
        await ctx.write({ content: '👋 Disconnected from the voice channel and cleared the queue.' });
    }
}

@Declare({
    name: 'leave',
    description: 'Disconnect the bot from voice channel (alias for /disconnect)'
})
export class LeaveCommand extends DisconnectCommand {}

@Declare({
    name: 'dc',
    description: 'Disconnect the bot from voice channel (alias for /disconnect)'
})
export class DcCommand extends DisconnectCommand {}

@Declare({
    name: 'stop',
    description: 'Stop music, clear queue, and disconnect (alias for /disconnect)'
})
export class StopCommand extends DisconnectCommand {}

export default DisconnectCommand;
