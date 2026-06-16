import { Command, Declare, Options, createStringOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to play next',
        required: true
    })
};

@Declare({
    name: 'playnext',
    description: 'Add a song to play next in the queue'
})
@Options(options)
export default class PlayNextCommand extends Command {
    async run(ctx) {
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
            
            await musicManager.playNextSong(channel, query, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}
