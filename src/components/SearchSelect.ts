import { ComponentCommand, type ComponentContext } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { verifyVoiceConnection, getRequesterId } from '../utils/permissions.js';
import { logger } from '../utils/logger.js';

export default class SearchSelectComponent extends ComponentCommand {
    componentType = 'StringSelect' as const;

    filter(ctx: ComponentContext<'StringSelect'>): boolean {
        return ctx.customId === 'search_select';
    }

    async run(ctx: ComponentContext<'StringSelect'>): Promise<any> {
        if (!ctx.guildId) return;

        const queue = musicManager.getQueue(ctx.guildId);
        const voiceChannelId = await verifyVoiceConnection(ctx, queue, true);
        if (!voiceChannelId) return;

        try {
            await ctx.deferReply();
        } catch (e: any) {
            logger.warn(
                'SearchSelectComponent',
                `Failed to defer interaction (likely timeout or unknown interaction): ${e.message || e}`
            );
            return;
        }

        const rawValue = ctx.interaction.values[0];
        let targetUrl = rawValue;

        const userId = getRequesterId(ctx);
        const cacheKey = `${ctx.guildId}:${userId}`;
        const cachedTracks = musicManager.getSearchCache(cacheKey);

        if (rawValue.startsWith('search_idx:')) {
            const idx = parseInt(rawValue.replace('search_idx:', ''), 10);
            const selected = cachedTracks?.[idx];
            if (!selected) {
                return ctx.editOrReply({
                    content: '❌ Search session expired. Please run `/search` again.'
                });
            }
            targetUrl = selected.originalUrl || selected.url;
        } else if (/^\d+$/.test(rawValue)) {
            const idx = parseInt(rawValue, 10);
            const selected = cachedTracks?.[idx];
            if (!selected) {
                return ctx.editOrReply({
                    content: '❌ Search session expired. Please run `/search` again.'
                });
            }
            targetUrl = selected.originalUrl || selected.url;
        }

        const channel = { id: voiceChannelId, guildId: ctx.guildId, client: ctx.client };

        try {
            await musicManager.play(channel, targetUrl, ctx);
        } catch (e) {
            logger.error('SearchSelectComponent', 'Search Component Error:', e);
            return ctx.editOrReply({ content: '❌ An error occurred while trying to play the selected song.' });
        }
    }
}

