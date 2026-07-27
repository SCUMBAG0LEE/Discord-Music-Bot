import { ComponentCommand } from 'seyfert';
import { musicManager, getPlayerControls } from '../services/MusicManager.js';

export default class PlayerControls extends ComponentCommand {
    componentType = "Button";

    filter(ctx) {
        return ctx.customId.startsWith('player_');
    }

    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue) {
            return ctx.editOrReply({ content: '❌ There is no active music queue in this server.', flags: 64 });
        }
        
        const voiceState = await ctx.client.cache.voiceStates?.get(ctx.member.id, ctx.guildId);
        const voiceChannelId = voiceState?.channelId;
        
        if (!voiceChannelId || voiceChannelId !== queue.voiceChannelId) {
            return ctx.editOrReply({ content: '❌ You must be in the same voice channel as the bot to use these controls.', flags: 64 });
        }
        
        switch (ctx.customId) {
            case 'player_pause':
                if (queue.paused) {
                    musicManager.resume(ctx.guildId);
                    await ctx.interaction.update({ components: [getPlayerControls(queue)] });
                } else {
                    musicManager.pause(ctx.guildId);
                    await ctx.interaction.update({ components: [getPlayerControls(queue)] });
                }
                break;
                
            case 'player_skip':
                if (queue.player) {
                    queue.player.stop();
                }
                await ctx.interaction.update({ content: '⏭️ **Skipped.**', components: [] });
                break;
                
            case 'player_loop':
                queue.loopMode = (queue.loopMode + 1) % 3;
                await ctx.interaction.update({ components: [getPlayerControls(queue)] });
                break;
                
            case 'player_stop':
                queue.songs = [];
                queue.player.stop();
                await ctx.interaction.update({ content: '⏹️ **Playback stopped.**', components: [] });
                break;
        }
    }
}
