import { Command, SubCommand, Declare, Options, Embed, createStringOption } from 'seyfert';
import { dbManager } from '../services/DatabaseManager.js';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

const nameOption = {
    name: createStringOption({
        description: 'Playlist name (1-32 characters)',
        required: true
    })
};

@Declare({
    name: 'save',
    description: 'Save the current queue as a personal playlist.'
})
@Options(nameOption)
export class PlaylistSaveSubCommand extends SubCommand {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: '❌ The queue is empty. Nothing to save.', flags: 64 });
        }

        const name = ctx.options.name;
        const songsToSave = queue.songs.map(song => ({
            title: song.title,
            url: song.originalUrl,
            duration: song.duration,
            source: song.sourceType || 'youtube',
            sourceUrl: song.originalUrl
        }));

        const { success, error } = await dbManager.savePlaylist(ctx.member.id, name, songsToSave);
        if (!success) {
            return ctx.write({ content: `❌ ${error}`, flags: 64 });
        }

        return ctx.write({ content: `💾 Saved **${songsToSave.length}** songs to playlist **${name}**` });
    }
}

@Declare({
    name: 'load',
    description: 'Load a saved playlist into the queue.'
})
@Options(nameOption)
export class PlaylistLoadSubCommand extends SubCommand {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            console.warn(`[PlaylistsCommand] Failed to defer interaction:`, e.message || e);
            return;
        }

        const name = ctx.options.name;
        const { playlist, error } = await dbManager.loadPlaylist(ctx.member.id, name);

        if (error) {
            return ctx.editOrReply({ content: `❌ ${error}` });
        }

        await ctx.editOrReply({ content: `📂 Loading playlist **${playlist.name}** (${playlist.songs.length} songs)...` });

        try {
            const channel = await ctx.client.cache.channels?.get(voiceChannelId);
            if (!channel) {
                return ctx.editOrReply({ content: '❌ Could not fetch your voice channel from the cache.' });
            }
            const songsToPlay = playlist.songs.map(song => ({
                title: song.title,
                originalUrl: song.url,
                duration: song.duration,
                sourceType: song.source || 'youtube'
            }));

            await musicManager.playSongs(channel, songsToPlay, ctx);
        } catch (e) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}

@Declare({
    name: 'delete',
    description: 'Delete a saved playlist.'
})
@Options(nameOption)
export class PlaylistDeleteSubCommand extends SubCommand {
    async run(ctx) {
        const name = ctx.options.name;
        const { success, error } = await dbManager.deletePlaylist(ctx.member.id, name);

        if (!success) {
            return ctx.write({ content: `❌ ${error}`, flags: 64 });
        }

        return ctx.write({ content: `🗑️ Deleted playlist **${name}**` });
    }
}

@Declare({
    name: 'list',
    description: 'List your saved playlists.'
})
export class PlaylistListSubCommand extends SubCommand {
    async run(ctx) {
        const { playlists, error } = await dbManager.listPlaylists(ctx.member.id);

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
            .setDescription(
                playlists.map((p, i) => 
                    `**${i + 1}.** ${p.name} — ${p.songCount} songs`
                ).join('\n')
            )
            .setFooter({ text: 'Use /playlist load <name> to play a playlist' });

        return ctx.write({ embeds: [embed] });
    }
}

@Declare({
    name: 'append',
    description: 'Add the current queue to an existing playlist.'
})
@Options(nameOption)
export class PlaylistAppendSubCommand extends SubCommand {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: '❌ The queue is empty.', flags: 64 });
        }

        const name = ctx.options.name;
        const songsToSave = queue.songs.map(song => ({
            title: song.title,
            url: song.originalUrl,
            duration: song.duration,
            source: song.sourceType || 'youtube',
            sourceUrl: song.originalUrl
        }));

        const { success, error } = await dbManager.appendToPlaylist(ctx.member.id, name, songsToSave);
        if (!success) {
            return ctx.write({ content: `❌ ${error}`, flags: 64 });
        }

        return ctx.write({ content: `➕ Added **${songsToSave.length}** songs to playlist **${name}**` });
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

// Legacy Top-Level Slash Command Exports for backward compatibility
@Declare({ name: 'savelist', description: 'Alias for /playlist save' })
@Options(nameOption)
export class SavelistCommand extends PlaylistSaveSubCommand {}

@Declare({ name: 'loadlist', description: 'Alias for /playlist load' })
@Options(nameOption)
export class LoadlistCommand extends PlaylistLoadSubCommand {}

@Declare({ name: 'deletelist', description: 'Alias for /playlist delete' })
@Options(nameOption)
export class DeletelistCommand extends PlaylistDeleteSubCommand {}

@Declare({ name: 'playlists', description: 'Alias for /playlist list' })
export class PlaylistsCommand extends PlaylistListSubCommand {}

@Declare({ name: 'appendlist', description: 'Alias for /playlist append' })
@Options(nameOption)
export class AppendlistCommand extends PlaylistAppendSubCommand {}
