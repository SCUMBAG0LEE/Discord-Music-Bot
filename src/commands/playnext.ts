import { Command, Declare, Options, createStringOption, type CommandContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, canUseDJCommands, djOnlyError } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

const options = {
    query: createStringOption({
        description: 'URL or search term for the song to play next',
        required: true
    }),
    platform: createStringOption({
        description: 'Platform search engine if not using a URL (default: YouTube)',
        required: false,
        choices: [
            { name: '🔴 YouTube', value: 'youtube' },
            { name: '🟠 SoundCloud', value: 'soundcloud' }
        ]
    })
};

@Declare({
    name: 'playnext',
    description: 'Add a song to play next in the queue'
})
@Options(options)
export default class PlayNextCommand extends Command {
    async run(ctx: CommandContext<typeof options>): Promise<any> {
        if (!ctx.guildId) return;
        const { query, platform } = ctx.options;
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        if (queue && !(await canUseDJCommands(ctx, queue))) {
            return djOnlyError(ctx);
        }

        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn(
                'PlayNextCommand',
                `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`
            );
            return;
        }

        try {
            const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };
            const searchPrefix = platform === 'soundcloud' ? 'scsearch1:' : 'ytsearch1:';

            await musicManager.playNextSong(channel, query, ctx, searchPrefix);
        } catch (e: any) {
            return ctx.editOrReply({ content: `❌ Error: ${e.message}` });
        }
    }
}

