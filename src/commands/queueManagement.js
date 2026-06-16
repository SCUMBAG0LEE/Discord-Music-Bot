import { Command, Declare, Options, createIntegerOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection } from '../utils/permissions.js';

@Declare({
    name: 'shuffle',
    description: 'Shuffle the queue (except the current song)'
})
export class ShuffleCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 2) {
            return ctx.write({ content: 'Not enough songs in the queue to shuffle.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        musicManager.shuffle(ctx.guildId);
        await ctx.write({ content: `🔀 Queue shuffled! (${queue.songs.length - 1} songs)` });
    }
}

@Declare({
    name: 'clear',
    description: 'Clear the queue (except the currently playing song)'
})
export class ClearCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 2) {
            return ctx.write({ content: 'Queue is already empty (only current song playing).', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const removedCount = queue.songs.length - 1;
        musicManager.clear(ctx.guildId);
        await ctx.write({ content: `🗑️ Cleared **${removedCount}** songs from the queue.` });
    }
}

const indexOption = {
    index: createIntegerOption({
        description: 'Position in queue (starts at 1)',
        required: true,
        min_value: 1
    })
};

@Declare({
    name: 'remove',
    description: 'Remove a song from the queue by its position'
})
@Options(indexOption)
export class RemoveCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 2) {
            return ctx.write({ content: 'No songs available to remove.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const index = ctx.options.index;
        if (index > queue.songs.length) {
            return ctx.write({ content: `Invalid index. Queue only has ${queue.songs.length} songs.`, flags: 64 });
        }
        
        // The queue UI displays the first upcoming song as '1.' which corresponds to queue.songs[1]
        // So the raw index passed by the user is exactly the index we want to target!
        const removed = musicManager.remove(ctx.guildId, index);
        if (removed) {
            await ctx.write({ content: `🗑️ Removed **${removed.title}** from the queue.` });
        } else {
            await ctx.write({ content: 'Could not remove song.', flags: 64 });
        }
    }
}

const moveOptions = {
    from: createIntegerOption({
        description: 'Current position (starts at 1)',
        required: true,
        min_value: 1
    }),
    to: createIntegerOption({
        description: 'New position',
        required: true,
        min_value: 1
    })
};

@Declare({
    name: 'move',
    description: 'Move a song in the queue from one position to another'
})
@Options(moveOptions)
export class MoveCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 3) {
            return ctx.write({ content: 'Not enough songs in the queue to move.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const from = ctx.options.from;
        const to = ctx.options.to;
        
        if (from > queue.songs.length || to > queue.songs.length) {
            return ctx.write({ content: `Invalid positions. Queue only has ${queue.songs.length} songs.`, flags: 64 });
        }
        
        const moved = musicManager.move(ctx.guildId, from, to);
        if (moved) {
            await ctx.write({ content: `↔️ Moved **${moved.title}** from position ${from} to ${to}.` });
        } else {
            await ctx.write({ content: 'Could not move song.', flags: 64 });
        }
    }
}

@Declare({
    name: 'jump',
    description: 'Jump to a specific song in the queue'
})
@Options(indexOption)
export class JumpCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 2) {
            return ctx.write({ content: 'There are no songs to jump to.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const index = ctx.options.index;
        if (index > queue.songs.length) {
            return ctx.write({ content: `Invalid index. Queue only has ${queue.songs.length} songs.`, flags: 64 });
        }
        
        const targetSong = queue.songs[index];
        musicManager.jump(ctx.guildId, index);
        
        await ctx.write({ content: `⏭️ Jumping to **${targetSong.title}**.` });
    }
}

@Declare({
    name: 'skipto',
    description: 'Skip to a specific song in the queue (alias for /jump)'
})
@Options({
    position: createIntegerOption({
        description: 'Position in queue to skip to',
        required: true,
        min_value: 1
    })
})
export class SkiptoCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length < 2) {
            return ctx.write({ content: 'There are no songs to skip to.', flags: 64 });
        }
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, false);
        if (!voiceChannelId) return;
        
        const position = ctx.options.position;
        if (position > queue.songs.length) {
            return ctx.write({ content: `Invalid position. Queue only has ${queue.songs.length} songs.`, flags: 64 });
        }
        
        const targetSong = queue.songs[position];
        musicManager.jump(ctx.guildId, position);
        
        await ctx.write({ content: `⏭️ Skipped to **${targetSong.title}**.` });
    }
}
