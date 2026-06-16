import { Command, Declare, Embed } from 'seyfert';
import { dbManager } from '../services/DatabaseManager.js';
import { musicManager } from '../services/MusicManager.js';

@Declare({
    name: 'like',
    description: 'Save the currently playing song to your personal favorites'
})
export class LikeCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: '❌ There is no song playing to like.', flags: 64 });
        }
        
        const song = queue.songs[0];
        const added = dbManager.addFavorite(ctx.member.id, song.url, song.title, song.duration);
        
        if (added) {
            await ctx.write({ content: `❤️ Added **${song.title}** to your favorites!` });
        } else {
            await ctx.write({ content: `You already have **${song.title}** in your favorites.`, flags: 64 });
        }
    }
}

@Declare({
    name: 'favorites',
    description: 'View your saved favorite songs'
})
export class FavoritesCommand extends Command {
    async run(ctx) {
        const favorites = dbManager.getFavorites(ctx.member.id);
        
        if (!favorites || favorites.length === 0) {
            return ctx.write({ content: 'You have no saved favorites yet! Use `/like` when a song is playing.', flags: 64 });
        }
        
        const embed = new Embed()
            .setTitle(`❤️ ${ctx.member.username}'s Favorites`)
            .setColor('#FF0000');
            
        let description = '';
        favorites.slice(0, 15).forEach((fav, i) => {
            description += `${i + 1}. **[${fav.title}](${fav.url})** - \`${fav.duration}\`\n`;
        });
        
        if (favorites.length > 15) {
            description += `\n*...and ${favorites.length - 15} more*`;
        }
        
        embed.setDescription(description);
        embed.setFooter({ text: 'To play them, you can queue them up directly!' }); // Will add /play favorites logic later if needed
        
        await ctx.write({ embeds: [embed] });
    }
}
