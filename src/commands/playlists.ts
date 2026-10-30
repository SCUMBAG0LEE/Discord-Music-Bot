import { Command, SubCommand, Declare, Options, Embed, createStringOption, type CommandContext } from 'seyfert';
import { dbManager } from '../services/DatabaseManager.js';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, verifyTextChannel, getRequesterId } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

const nameOption = {
    name: createStringOption({
        description: 'Playlist name (1-32 characters)',
        required: true
    })
};

async function handlePlaylistSave(ctx: CommandContext<typeof nameOption>): Promise<any> {
    if (!ctx.guildId) return;
    if (!(await verifyTextChannel(ctx))) return;

    const queue = musicManager.getQueue(ctx.guildId);
    if (!queue || queue.songs.length === 0) {
        return ctx.write({ content: '❌ The queue is empty. Nothing to save.', flags: 64 });
    }

    const userId = getRequesterId(ctx);
    const name = ctx.options.name;
    const songsToSave = queue.songs.map(song => ({
        title: song.title,
        url: song.originalUrl,
        duration: song.duration,
        source: song.sourceType || 'youtube',
        sourceUrl: song.originalUrl
    }));

    const { success, error } = await dbManager.savePlaylist(userId, name, songsToSave);
    if (!success) {
        return ctx.write({ content: `❌ ${error}`, flags: 64 });
    }

    return ctx.write({ content: `💾 Saved **${songsToSave.length}** songs to playlist **${name}**` });
}

async function handlePlaylistLoad(ctx: CommandContext<typeof nameOption>): Promise<any> {
    if (!ctx.guildId) return;
    const queue = musicManager.getQueue(ctx.guildId);
    const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
    if (!voiceChannelId) return;

    try {
        await ctx.deferReply();
    } catch (e: any) {
        logger.warn('PlaylistsCommand', `Failed to defer interaction: ${e.message || e}`);
        return;
    }

    const userId = getRequesterId(ctx);
    const name = ctx.options.name;
    const { playlist, error } = await dbManager.loadPlaylist(userId, name);

    if (error || !playlist) {
        return ctx.editOrReply({ content: `❌ ${error || 'Playlist not found.'}` });
    }

    await ctx.editOrReply({
        content: `📂 Loading playlist **${playlist.name}** (${playlist.songs.length} songs)...`
    });

    try {
        const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
        const songsToPlay = playlist.songs.map(song => ({
            title: song.title,
            originalUrl: song.url,
            duration: String(song.duration),
            sourceType: song.source || 'youtube'
        }));

        await musicManager.playSongs(channel, songsToPlay, ctx);
    } catch (e: any) {
        return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
    }
}

async function handlePlaylistDelete(ctx: CommandContext<typeof nameOption>): Promise<any> {
    if (!(await verifyTextChannel(ctx))) return;

    const userId = getRequesterId(ctx);
    const name = ctx.options.name;
    const { success, error } = await dbManager.deletePlaylist(userId, name);

    if (!success) {
        return ctx.write({ content: `❌ ${error}`, flags: 64 });
    }

    return ctx.write({ content: `🗑️ Deleted playlist **${name}**` });
}

async function handlePlaylistList(ctx: CommandContext): Promise<any> {
    if (!(await verifyTextChannel(ctx))) return;

    const userId = getRequesterId(ctx);
    const { playlists, error } = await dbManager.listPlaylists(userId);

    if (error) {
        return ctx.write({ content: `❌ ${error}`, flags: 64 });
    }

    if (playlists.length === 0) {
        return ctx.write({
            content: 'You have no saved playlists. Use `/playlist save` to create one!',
            flags: 64
        });
    }

    const embed = new Embed()
        .setTitle('📚 Your Playlists')
        .setColor('#5865F2')
        .setDescription(playlists.map((p, i) => `**${i + 1}.** ${p.name} — ${p.songCount} songs`).join('\n'))
        .setFooter({ text: 'Use /playlist load <name> to play a playlist' });

    return ctx.write({ embeds: [embed] });
}

async function handlePlaylistAppend(ctx: CommandContext<typeof nameOption>): Promise<any> {
    if (!ctx.guildId) return;
    if (!(await verifyTextChannel(ctx))) return;

    const queue = musicManager.getQueue(ctx.guildId);
    if (!queue || queue.songs.length === 0) {
        return ctx.write({ content: '❌ The queue is empty.', flags: 64 });
    }

    const userId = getRequesterId(ctx);
    const name = ctx.options.name;
    const songsToSave = queue.songs.map(song => ({
        title: song.title,
        url: song.originalUrl,
        duration: song.duration,
        source: song.sourceType || 'youtube',
        sourceUrl: song.originalUrl
    }));

    const { success, error } = await dbManager.appendToPlaylist(userId, name, songsToSave);
    if (!success) {
        return ctx.write({ content: `❌ ${error}`, flags: 64 });
    }

    return ctx.write({ content: `➕ Added **${songsToSave.length}** songs to playlist **${name}**` });
}

@Declare({
    name: 'save',
    description: 'Save the current queue as a personal playlist.'
})
@Options(nameOption)
class PlaylistSaveSubCommand extends SubCommand {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistSave(ctx);
    }
}

@Declare({
    name: 'load',
    description: 'Load a saved playlist into the queue.'
})
@Options(nameOption)
class PlaylistLoadSubCommand extends SubCommand {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistLoad(ctx);
    }
}

@Declare({
    name: 'delete',
    description: 'Delete a saved playlist.'
})
@Options(nameOption)
class PlaylistDeleteSubCommand extends SubCommand {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistDelete(ctx);
    }
}

@Declare({
    name: 'list',
    description: 'List your saved playlists.'
})
class PlaylistListSubCommand extends SubCommand {
    async run(ctx: CommandContext): Promise<any> {
        return handlePlaylistList(ctx);
    }
}

@Declare({
    name: 'append',
    description: 'Add the current queue to an existing playlist.'
})
@Options(nameOption)
class PlaylistAppendSubCommand extends SubCommand {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistAppend(ctx);
    }
}

// Parent Slash Command: /playlist <save|load|list|delete|append>
@Declare({
    name: 'playlist',
    description: 'Create, load, list, and manage your personal playlists'
})
@Options([
    PlaylistSaveSubCommand,
    PlaylistLoadSubCommand,
    PlaylistListSubCommand,
    PlaylistDeleteSubCommand,
    PlaylistAppendSubCommand
])
export class PlaylistCommand extends Command {}

// Legacy Top-Level Slash Command Exports (extend Command, NOT SubCommand)
@Declare({ name: 'savelist', description: 'Save the current queue as a personal playlist (alias for /playlist save)' })
@Options(nameOption)
export class SavelistCommand extends Command {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistSave(ctx);
    }
}

@Declare({ name: 'loadlist', description: 'Load a saved playlist into the queue (alias for /playlist load)' })
@Options(nameOption)
export class LoadlistCommand extends Command {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistLoad(ctx);
    }
}

@Declare({ name: 'deletelist', description: 'Delete a saved playlist (alias for /playlist delete)' })
@Options(nameOption)
export class DeletelistCommand extends Command {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistDelete(ctx);
    }
}

@Declare({ name: 'playlists', description: 'List your saved playlists (alias for /playlist list)' })
export class PlaylistsCommand extends Command {
    async run(ctx: CommandContext): Promise<any> {
        return handlePlaylistList(ctx);
    }
}

@Declare({ name: 'appendlist', description: 'Add the current queue to an existing playlist (alias for /playlist append)' })
@Options(nameOption)
export class AppendlistCommand extends Command {
    async run(ctx: CommandContext<typeof nameOption>): Promise<any> {
        return handlePlaylistAppend(ctx);
    }
}

