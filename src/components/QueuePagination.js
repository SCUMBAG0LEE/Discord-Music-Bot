import { ComponentCommand, ActionRow, Button } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';

export default class QueuePagination extends ComponentCommand {
    componentType = "Button";

    filter(ctx) {
        return ctx.customId.startsWith('queue_prev_') || ctx.customId.startsWith('queue_next_');
    }

    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        
        if (!queue || queue.songs.length === 0) {
            return ctx.editOrReply({ content: 'The queue is currently empty.', components: [] });
        }
        
        const page = parseInt(ctx.customId.split('_').pop());
        const totalPages = Math.ceil(queue.songs.length / 10) || 1;
        
        if (page > totalPages || page < 1) {
            return ctx.editOrReply({ content: `❌ Invalid page. There are only ${totalPages} pages.`, components: [] });
        }
        
        const start = (page - 1) * 10;
        const end = start + 10;
        const currentSongs = queue.songs.slice(start, end);
        
        let message = `**Current Queue (Page ${page}/${totalPages}):**\n\n`;
        currentSongs.forEach((song, i) => {
            const index = start + i;
            message += `${index === 0 ? '▶️' : `${index}.`} **${song.title}** - \`${song.duration}\`\n`;
        });
        
        if (queue.songs.length > 10) {
            message += `\n*Total Songs: ${queue.songs.length}*`;
        }
        
        const row = new ActionRow().setComponents([
            new Button()
                .setCustomId(`queue_prev_${page - 1}`)
                .setLabel('◀️ Previous')
                .setStyle(1) // Primary
                .setDisabled(page === 1),
            new Button()
                .setCustomId(`queue_next_${page + 1}`)
                .setLabel('▶️ Next')
                .setStyle(1) // Primary
                .setDisabled(page === totalPages)
        ]);
        
        // Update the existing message with the new page content
        await ctx.interaction.update({ content: message, components: [row] });
    }
}
