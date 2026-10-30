import {
    Command,
    Declare,
    Options,
    createStringOption,
    Embed,
    ActionRow,
    StringSelectMenu,
    StringSelectOption,
    type CommandContext
} from 'seyfert';
import { verifyVoiceConnection, getRequesterId } from '../utils/permissions.js';
import { musicManager } from '../services/MusicManager.js';
import { logger } from '../utils/logger.js';

const searchOptions = {
    query: createStringOption({
        description: 'What do you want to search for?',
        required: true
    }),
    platform: createStringOption({
        description: 'Platform to search on (default: YouTube)',
        required: false,
        choices: [
            { name: '🔴 YouTube', value: 'youtube' },
            { name: '🟠 SoundCloud', value: 'soundcloud' }
        ]
    })
};

@Declare({
    name: 'search',
    description: 'Search for a song and pick from 10 results'
})
@Options(searchOptions)
export default class SearchCommand extends Command {
    async run(ctx: CommandContext<typeof searchOptions>): Promise<any> {
        if (!ctx.guildId) return;
        const query = ctx.options.query;
        const platform = (ctx.options.platform || 'youtube') as 'youtube' | 'soundcloud';
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn(
                'SearchCommand',
                `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`
            );
            return;
        }

        try {
            const { tracks: results } = await musicManager.search(query, platform, 10);

            if (!results || results.length === 0) {
                return ctx.editOrReply({ content: '❌ No results found.' });
            }

            const userId = getRequesterId(ctx);
            musicManager.setSearchCache(`${ctx.guildId}:${userId}`, results);

            const platformName = platform === 'soundcloud' ? 'SoundCloud' : 'YouTube';
            const embedColor = platform === 'soundcloud' ? '#FF5500' : '#FF0000';

            const embed = new Embed()
                .setTitle(`Search Results (${platformName}): ${query}`)
                .setColor(embedColor);

            let description = '**Select a song from the dropdown menu below:**\n\n';
            results.slice(0, 10).forEach((res, i) => {
                description += `**${i + 1}.** [${res.title}](${res.originalUrl}) - \`${res.duration}\` | 👤 \`${res.channel}\`\n`;
            });

            embed.setDescription(description);
            embed.setFooter({ text: `${platformName} Search Results` });

            const selectMenu = new StringSelectMenu()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play...')
                .setOptions(
                    results.slice(0, 10).map((res, i) => {
                        const title = res.title.substring(0, 95);
                        const optionValue =
                            res.originalUrl && res.originalUrl.length <= 95
                                ? res.originalUrl
                                : `search_idx:${i}`;
                        return new StringSelectOption()
                            .setLabel(`${i + 1}. ${title}`)
                            .setDescription(`👤 ${res.channel} | ⏱️ ${res.duration}`.substring(0, 100))
                            .setValue(optionValue);
                    })
                );

            const row = new ActionRow<StringSelectMenu>().setComponents([selectMenu]);

            await ctx.editOrReply({ content: '', embeds: [embed], components: [row] });
        } catch (e: any) {
            logger.error('SearchCommand', 'Search Error:', e);
            const errorMessage = e.message ? e.message.substring(0, 500) : 'Unknown error';
            return ctx.editOrReply({ content: `❌ An error occurred while searching: \`${errorMessage}\`` });
        }
    }
}

