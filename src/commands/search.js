import { Command, Declare, Options, createStringOption, Embed, ActionRow, StringSelectMenu, StringSelectOption } from 'seyfert';
import { getYtDlpArgs } from '../utils/cookies.js';
import { verifyVoiceConnection } from '../utils/permissions.js';
import { musicManager, execFileAsync } from '../services/MusicManager.js';
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
    async run(ctx) {
        const query = ctx.options.query;
        const platform = ctx.options.platform || 'youtube';
        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e) {
            logger.warn('SearchCommand', `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`);
            return;
        }
        
        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const searchPrefix = platform === 'soundcloud' ? 'scsearch10:' : 'ytsearch10:';
            
            // Use --flat-playlist so yt-dlp only fetches basic metadata (instantly) instead of the entire formats array
            const args = getYtDlpArgs(['-j', '--flat-playlist', '--socket-timeout', '15', '--no-warnings', `${searchPrefix}${query}`]);
            
            // Search 10 results and output JSON with increased maxBuffer
            const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 });
            
            // yt-dlp outputs one JSON object per line for multiple results
            const lines = stdout.trim().split('\n');
            if (lines.length === 0 || !lines[0]) {
                return ctx.editOrReply({ content: '❌ No results found.' });
            }
            
            const results = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch(e) { return null; }
            }).filter(r => r);
            
            if (!results.length) {
                return ctx.editOrReply({ content: '❌ No results found.' });
            }
            
            const platformName = platform === 'soundcloud' ? 'SoundCloud' : 'YouTube';
            const embedColor = platform === 'soundcloud' ? '#FF5500' : '#FF0000';
            
            const embed = new Embed()
                .setTitle(`Search Results (${platformName}): ${query}`)
                .setColor(embedColor);
                
            let description = '**Select a song from the dropdown menu below:**\n\n';
            results.slice(0, 10).forEach((res, i) => {
                const duration = res.duration ? `${Math.floor(res.duration / 60)}:${(res.duration % 60).toString().padStart(2, '0')}` : 'Unknown';
                const channel = res.channel || res.uploader || 'Unknown';
                description += `**${i + 1}.** [${res.title || res.fulltitle}](${res.webpage_url || res.url}) - \`${duration}\` | 👤 \`${channel}\`\n`;
            });
            
            embed.setDescription(description);
            embed.setFooter({ text: `${platformName} Search Results` });
            
            const selectMenu = new StringSelectMenu()
                .setCustomId('search_select')
                .setPlaceholder('Select a song to play...')
                .setOptions(results.slice(0, 10).map((res, i) => {
                    const duration = res.duration ? `${Math.floor(res.duration / 60)}:${(res.duration % 60).toString().padStart(2, '0')}` : 'Unknown';
                    const channel = res.channel || res.uploader || 'Unknown';
                    const title = (res.title || res.fulltitle).substring(0, 95);
                    return new StringSelectOption()
                        .setLabel(`${i + 1}. ${title}`)
                        .setDescription(`👤 ${channel} | ⏱️ ${duration}`.substring(0, 100))
                        .setValue(res.webpage_url || res.url);
                }));

            const row = new ActionRow().setComponents([selectMenu]);
            
            await ctx.editOrReply({ content: '', embeds: [embed], components: [row] });
            
        } catch (e) {
            logger.error('SearchCommand', "Search Error:", e);
            const errorMessage = e.message ? e.message.substring(0, 500) : 'Unknown error';
            return ctx.editOrReply({ content: `❌ An error occurred while searching: \`${errorMessage}\`` });
        }
    }
}
