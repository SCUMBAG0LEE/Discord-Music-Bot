import { Command, SubCommand, Declare, Options, Embed, type CommandContext } from 'seyfert';
import { dbManager } from '../services/DatabaseManager.js';
import { musicManager } from '../services/MusicManager.js';
import { getRequesterId, getRequesterName, verifyTextChannel } from '../utils/permissions.js';

async function handleFavoriteAdd(ctx: CommandContext): Promise<any> {
    if (!ctx.guildId) return;
    if (!(await verifyTextChannel(ctx))) return;

    const queue = musicManager.getQueue(ctx.guildId);

    if (!queue || queue.songs.length === 0) {
        return ctx.write({ content: '❌ There is no song playing to like.', flags: 64 });
    }

    const userId = getRequesterId(ctx);
    const song = queue.songs[0];
    const added = await dbManager.addFavorite(userId, song.url || song.originalUrl, song.title, song.duration);

    if (added) {
        await ctx.write({ content: `❤️ Added **${song.title}** to your favorites!` });
    } else {
        await ctx.write({ content: `You already have **${song.title}** in your favorites.`, flags: 64 });
    }
}

async function handleFavoriteList(ctx: CommandContext): Promise<any> {
    if (!(await verifyTextChannel(ctx))) return;

    const userId = getRequesterId(ctx);
    const username = getRequesterName(ctx);
    const favorites = await dbManager.getFavorites(userId);

    if (!favorites || favorites.length === 0) {
        return ctx.write({
            content: 'You have no saved favorites yet! Use `/favorite add` or `/like` when a song is playing.',
            flags: 64
        });
    }

    const embed = new Embed().setTitle(`❤️ ${username}'s Favorites`).setColor('#FF0000');

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

@Declare({
    name: 'add',
    description: 'Save the currently playing song to your personal favorites'
})
class FavoriteAddSubCommand extends SubCommand {
    async run(ctx: CommandContext): Promise<any> {
        return handleFavoriteAdd(ctx);
    }
}

@Declare({
    name: 'list',
    description: 'View your saved favorite songs'
})
class FavoriteListSubCommand extends SubCommand {
    async run(ctx: CommandContext): Promise<any> {
        return handleFavoriteList(ctx);
    }
}

// Parent Slash Command: /favorite <add|list>
@Declare({
    name: 'favorite',
    description: 'Manage your favorite songs'
})
@Options([FavoriteAddSubCommand, FavoriteListSubCommand])
export class FavoriteCommand extends Command {}

// Top-Level Shorthand Slash Command Aliases (/like & /favorites)
@Declare({ name: 'like', description: 'Save the currently playing song to your favorites (alias for /favorite add)' })
export class LikeCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        return handleFavoriteAdd(ctx);
    }
}

@Declare({ name: 'favorites', description: 'View your saved favorite songs (alias for /favorite list)' })
export class FavoritesCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        return handleFavoriteList(ctx);
    }
}

