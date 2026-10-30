import { Command, Declare, type CommandContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, getRequesterId, getRequesterName } from '../utils/permissions.js';
import { getEffectiveSkipRatio } from '../services/serverSettings.js';
import { logger } from '../utils/logger.js';

@Declare({
    name: 'voteskip',
    description: 'Vote to skip the current song'
})
export class VoteSkipCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        if (!ctx.guildId) return;
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'There is no music playing.', flags: 64 });
        }

        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;

        const userId = getRequesterId(ctx);
        const username = getRequesterName(ctx);

        if (queue.skipVotes.has(userId)) {
            return ctx.write({ content: 'You have already voted to skip!', flags: 64 });
        }

        queue.skipVotes.add(userId);

        // Calculate required votes based on human listeners in VC (excluding all bots)
        let listeners = 1;
        try {
            const states = await ctx.client.cache.voiceStates?.values(ctx.guildId);
            if (states) {
                const botId = ctx.client.botId || ctx.client.me?.id;
                const activeHumanIds = new Set<string>();
                for (const vs of states) {
                    if (vs.channelId === queue.voiceChannelId && vs.userId !== botId) {
                        const userObj = await ctx.client.cache.users?.get(vs.userId);
                        if (userObj?.bot) continue;
                        activeHumanIds.add(vs.userId);
                    }
                }
                for (const voterId of [...queue.skipVotes]) {
                    if (!activeHumanIds.has(voterId)) queue.skipVotes.delete(voterId);
                }
                listeners = Math.max(1, activeHumanIds.size);
            }
        } catch (e) {
            logger.error('VoteSkip', 'Error fetching voice states', e);
        }

        const ratio = await getEffectiveSkipRatio(
            ctx.guildId,
            parseFloat(process.env.SKIP_RATIO || '0.5') || 0.5
        );
        const requiredVotes = Math.max(1, Math.ceil(listeners * ratio));

        if (queue.skipVotes.size >= requiredVotes) {
            await ctx.write({ content: `⏭️ Vote passed! Skipping **${queue.songs[0].title}**...` });
            musicManager.skip(ctx.guildId);
        } else {
            await ctx.write({
                content: `🗳️ **${username}** voted to skip! (${queue.skipVotes.size}/${requiredVotes} required)`
            });
        }
    }
}

