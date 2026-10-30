import {
    Command,
    Declare,
    Options,
    createIntegerOption,
    ActionRow,
    Button,
    Embed,
    type CommandContext
} from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyTextChannel } from '../utils/permissions.js';

const options = {
    page: createIntegerOption({
        description: 'Page number to view',
        required: false
    })
};

@Declare({
    name: 'queue',
    description: 'Display the current music queue'
})
@Options(options)
export default class QueueCommand extends Command {
    async run(ctx: CommandContext<typeof options>): Promise<any> {
        if (!ctx.guildId) return;
        if (!(await verifyTextChannel(ctx))) return;

        const queue = musicManager.getQueue(ctx.guildId);

        if (!queue || queue.songs.length === 0) {
            return ctx.write({ content: 'The queue is currently empty.', flags: 64 });
        }

        const page = ctx.options.page || 1;
        const totalPages = Math.ceil(queue.songs.length / 10) || 1;

        if (page > totalPages || page < 1) {
            return ctx.write({
                content: `❌ Invalid page. There are only ${totalPages} pages.`,
                flags: 64
            });
        }

        const start = (page - 1) * 10;
        const end = start + 10;
        const currentSongs = queue.songs.slice(start, end);

        let description = '';
        currentSongs.forEach((song, i) => {
            const index = start + i;
            description += `${index === 0 ? '▶️' : `**${index}.**`} [${song.title}](${song.originalUrl}) - \`${song.duration}\`\n`;
        });

        const embed = new Embed()
            .setTitle('📋 Current Queue')
            .setDescription(description)
            .setColor('#5865F2')
            .setFooter({ text: `Page ${page}/${totalPages} • Total Songs: ${queue.songs.length}` });

        const row = new ActionRow<Button>().setComponents([
            new Button()
                .setCustomId(`queue_prev_${page - 1}`)
                .setLabel('◀️ Previous')
                .setStyle(1)
                .setDisabled(page === 1),
            new Button()
                .setCustomId(`queue_next_${page + 1}`)
                .setLabel('▶️ Next')
                .setStyle(1)
                .setDisabled(page === totalPages)
        ]);

        await ctx.write({ embeds: [embed], components: [row] });
    }
}

