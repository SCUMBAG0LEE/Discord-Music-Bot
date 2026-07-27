import { Command, Declare, Embed } from 'seyfert';
import { musicManager, getPlayerControls } from '../services/MusicManager.js';

@Declare({
    name: 'nowplaying',
    description: 'Display the currently playing song'
})
export class NowPlayingCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'No song is currently playing.', flags: 64 });
        }
        
        const song = queue.songs[0];
        
        const embed = new Embed()
            .setTitle(`🎵 Now Playing`)
            .setDescription(`**[${song.title}](${song.originalUrl})**\n\n\`Duration: ${song.duration}\``)
            .setColor('#5865F2')
            .setFooter({ text: `${queue.paused ? '⏸️ Paused' : '▶️ Playing'}` });
        
        const row = getPlayerControls(queue);

        // Clean up button controls on previous Now Playing message
        if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
            try {
                await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, { components: [] });
            } catch (e) {}
            queue.lastNowPlayingMessageId = null;
        }
        
        await ctx.write({ content: 'Summoning Now Playing panel...' });
        
        const sentMsg = await musicManager.sendMessage(queue, { embeds: [embed], components: [row] });
        if (sentMsg && sentMsg.id) {
            queue.lastNowPlayingMessageId = sentMsg.id;
            queue.textChannelId = sentMsg.channelId;
        }
    }
}

@Declare({
    name: 'np',
    description: 'Display the currently playing song (alias for /nowplaying)'
})
export class NpCommand extends NowPlayingCommand {}

export default NowPlayingCommand;
