import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { isDJ, djOnlyError } from '../utils/permissions.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to force play immediately',
        required: true
    })
};

@Declare({
    name: 'forceplay',
    description: 'Play a song immediately, skipping the current one (DJ only)'
})
@Options(options)
export default class ForcePlayCommand extends Command {
    async run(ctx) {
        if (!isDJ(ctx.member)) {
            return djOnlyError(ctx);
        }

        const { query } = ctx.options;
        const voiceState = await ctx.client.cache.voiceStates?.get(ctx.member.id, ctx.guildId);
        const voiceChannelId = voiceState?.channelId;
        
        if (!voiceChannelId) {
            return ctx.write({ content: '❌ You must join a voice channel first!', flags: 64 });
        }
        
        const { canUseVoiceChannel, loadSettings } = await import('../services/serverSettings.js');
        if (!canUseVoiceChannel(ctx.guildId, voiceChannelId)) {
            const settings = loadSettings(ctx.guildId);
            return ctx.write({ 
                content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
                flags: 64 
            });
        }

        await ctx.deferReply();
        
        try {
            const channel = await ctx.client.cache.channels?.get(voiceChannelId);
            if (!channel) {
                return ctx.editOrReply({ content: '❌ Could not fetch your voice channel from the cache.' });
            }
            
            await musicManager.forcePlay(channel, query, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
