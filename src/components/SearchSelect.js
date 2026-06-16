import { ComponentCommand } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';

export default class SearchSelectComponent extends ComponentCommand {
    componentType = "StringSelect";

    filter(ctx) {
        return ctx.customId === 'search_select';
    }

    async run(ctx) {
        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[SearchSelectComponent] Failed to defer interaction (likely timeout or unknown interaction):`, e.message || e);
            return;
        }
        
        const url = ctx.interaction.values[0];
        const voiceState = await ctx.client.cache.voiceStates?.get(ctx.member.id, ctx.guildId);
        const voiceChannelId = voiceState?.channelId;
        
        if (!voiceChannelId) {
            return ctx.editOrReply({ content: '❌ You must join a voice channel first!' });
        }
        
        const channel = await ctx.client.cache.channels?.get(voiceChannelId);

        try {
            await musicManager.play(channel, url, ctx);
        } catch (e) {
            console.error("Search Component Error:", e);
            return ctx.editOrReply({ content: '❌ An error occurred while trying to play the selected song.' });
        }
    }
}
