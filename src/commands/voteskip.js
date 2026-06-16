import { Command, Declare } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';

@Declare({
    name: 'voteskip',
    description: 'Vote to skip the current song'
})
export class VoteSkipCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'There is no music playing.', flags: 64 });
        }
        
        const userId = ctx.member.id;
        
        if (queue.skipVotes.has(userId)) {
            return ctx.write({ content: 'You have already voted to skip!', flags: 64 });
        }
        
        queue.skipVotes.add(userId);
        
        // Calculate required votes
        let listeners = 1;
        try {
            const states = await ctx.client.cache.voiceStates.values(ctx.guildId);
            // queue.channel is the voice channel ID string that was passed in play() or it's the channel object?
            // Wait, in play(), channel was passed as the channel object or ID. Let's check:
            // queue.channel is the voice channel object!
            const inChannel = states.filter(vs => vs.channelId === queue.channel.id);
            listeners = inChannel.length || 1;
            // Subtract the bot itself from listener count
            if (listeners > 1) listeners -= 1; 
        } catch (e) {
            console.error("Error fetching voice states:", e);
        }
        
        const ratio = parseFloat(process.env.SKIP_RATIO) || 0.5;
        const requiredVotes = Math.max(1, Math.ceil(listeners * ratio));
        
        if (queue.skipVotes.size >= requiredVotes) {
            await ctx.write({ content: `⏭️ Vote passed! Skipping **${queue.songs[0].title}**...` });
            musicManager.skip(ctx.guildId);
        } else {
            await ctx.write({ content: `🗳️ **${ctx.member.username}** voted to skip! (${queue.skipVotes.size}/${requiredVotes} required)` });
        }
    }
}
