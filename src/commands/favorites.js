import { Command, SubCommand, Declare, Options, Embed } from 'seyfert';
import { dbManager } from '../services/DatabaseManager.js';
import { musicManager } from '../services/MusicManager.js';

@Declare({
    name: 'add',
    description: 'Save the currently playing song to your personal favorites'
})
export class FavoriteAddSubCommand extends SubCommand {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: '❌ There is no song playing to like.', flags: 64 });
        }
        
        const song = queue.songs[0];
        const added = await dbManager.addFavorite(ctx.member.id, song.url || song.originalUrl, song.title, song.duration);
        
        if (added) {
            await ctx.write({ content: `❤️ Added **${song.title}** to your favorites!` });
        } else {
            await ctx.write({ content: `You already have **${song.title}** in your favorites.`, flags: 64 });
        }
    }
}

@Declare({
    name: 'list',
    description: 'View your saved favorite songs'
})
export class FavoriteListSubCommand extends SubCommand {
    async run(ctx) {
        const favorites = await dbManager.getFavorites(ctx.member.id);
        
        if (!favorites || favorites.length === 0) {
            return ctx.write({ content: 'You have no saved favorites yet! Use `/favorite add` or `/like` when a song is playing.', flags: 64 });
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
        embed.setFooter({ text: 'To play them, queue them up with /play!' });
        
        await ctx.write({ embeds: [embed] });
    }
}

// Parent Slash Command: /favorite <add|list>
@Declare({
    name: 'favorite',
    description: 'Manage your favorite songs'
})
@Options([FavoriteAddSubCommand, FavoriteListSubCommand])
export class FavoriteCommand extends Command {}

// Shorthand Slash Command Aliases (/like & /favorites)
@Declare({ name: 'like', description: 'Alias for /favorite add' })
export class LikeCommand extends FavoriteAddSubCommand {}

@Declare({ name: 'favorites', description: 'Alias for /favorite list' })
export class FavoritesCommand extends FavoriteListSubCommand {}
