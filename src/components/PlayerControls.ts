import { ComponentCommand, type ComponentContext } from 'seyfert';
import { musicManager, getPlayerControls } from '../services/MusicManager.js';
import { canUseDJCommands, djOnlyError, getRequesterId } from '../utils/permissions.js';

export default class PlayerControls extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<'Button'>): boolean {
        return ctx.customId.startsWith('player_');
    }

    async run(ctx: ComponentContext<'Button'>): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue) {
            return ctx.editOrReply({ content: '❌ There is no active music queue in this server.', flags: 64 });
        }

        const userId = getRequesterId(ctx);
        const voiceState = await ctx.client.cache.voiceStates?.get(userId, ctx.guildId);
        const voiceChannelId = voiceState?.channelId;

        if (!voiceChannelId || voiceChannelId !== queue.voiceChannelId) {
            return ctx.editOrReply({
                content: '❌ You must be in the same voice channel as the bot to use these controls.',
                flags: 64
            });
        }

        // Disable buttons on old Now Playing messages to prevent confusion
        if (queue.lastNowPlayingMessageId && ctx.interaction.message.id !== queue.lastNowPlayingMessageId) {
            return ctx.interaction.update({ components: [] });
        }

        if (!(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
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
                queue.lastNowPlayingMessageId = null;
                await ctx.interaction.update({ content: '⏭️ **Skipped.**', components: [] });
                musicManager.skip(ctx.guildId);
                break;

            case 'player_loop':
                queue.loopMode = (queue.loopMode + 1) % 3;
                await ctx.interaction.update({ components: [getPlayerControls(queue)] });
                break;

            case 'player_stop':
                queue.lastNowPlayingMessageId = null;
                await ctx.interaction.update({ content: '⏹️ **Playback stopped.**', components: [] });
                musicManager.leave(ctx.guildId);
                break;
        }
    }
}

