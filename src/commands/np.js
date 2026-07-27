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
        
        await ctx.write({ embeds: [embed], components: [row] });
    }
}

@Declare({
    name: 'np',
    description: 'Display the currently playing song (alias for /nowplaying)'
})
export class NpCommand extends NowPlayingCommand {}

export default NowPlayingCommand;
