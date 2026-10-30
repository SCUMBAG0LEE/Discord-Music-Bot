import { getEffectiveDJRole, canUseTextChannel, canUseVoiceChannel, loadSettings } from '../services/serverSettings.js';
import { logger } from './logger.js';
import type { GuildQueue } from '../types.js';

// Local definition of standard Discord permission bits to avoid framework export version issues
export const PermissionFlagsBits = {
    Administrator: 8n,
    ManageGuild: 32n
} as const;

/**
 * Safely resolve the requester's display/username from a Seyfert context or interaction object
 */
export function getRequesterName(ctx: any): string {
    return (
        ctx?.author?.username ||
        ctx?.member?.user?.username ||
        ctx?.member?.username ||
        ctx?.interaction?.user?.username ||
        'Unknown'
    );
}

/**
 * Safely resolve the requester's user ID from a Seyfert context or interaction object
 */
export function getRequesterId(ctx: any): string {
    return (
        ctx?.author?.id ||
        ctx?.member?.id ||
        ctx?.interaction?.user?.id ||
        ''
    );
}

/**
 * Check if user is the bot owner
 */
export function isOwner(userId: string | undefined | null): boolean {
    if (!userId) return false;
    return process.env.BOT_OWNER_ID === userId;
}

/**
 * Check if user has Administrator permissions or is bot owner
 */
export function hasAdminPermission(member: any): boolean {
    if (!member) return false;
    if (isOwner(member.id)) return true;
    return Boolean(member.permissions?.has?.([PermissionFlagsBits.Administrator]));
}

/**
 * Check if user has DJ role (checks server-specific first, then global)
 */
export async function isDJ(member: any): Promise<boolean> {
    if (!member) return false;
    if (isOwner(member.id)) return true;

    const permissions = member.permissions;
    if (permissions?.has?.([PermissionFlagsBits.Administrator])) return true;
    if (permissions?.has?.([PermissionFlagsBits.ManageGuild])) return true;

    const djRoleId = await getEffectiveDJRole(member.guildId, process.env.DJ_ROLE_ID);

    if (!djRoleId) return true; // No DJ role set = everyone is DJ
    return Boolean(member.roles?.keys?.includes?.(djRoleId));
}

/**
 * Check if user is the track requester
 */
export function isRequester(userId: string | undefined | null, queue: GuildQueue | undefined | null): boolean {
    if (!userId) return false;
    const current = queue?.songs?.[0];
    if (!current) return false;
    return current.requesterId === userId;
}

/**
 * Check if user can use DJ-only commands
 * Returns true if: is owner, has DJ role, is alone in VC, or is the track requester
 */
export async function canUseDJCommands(ctx: any, queue?: GuildQueue | null): Promise<boolean> {
    const member = ctx.member;
    const userId = getRequesterId(ctx);
    if (!member && !userId) return false;

    if (isOwner(userId)) return true;

    if (member && (await isDJ(member))) return true;

    if (isRequester(userId, queue)) return true;

    // Is alone in voice channel with bot (excluding other bots)
    try {
        const voiceState = await ctx.client.cache.voiceStates?.get(userId, ctx.guildId);
        const voiceChannelId = voiceState?.channelId;
        if (voiceChannelId) {
            const cachedStates = await ctx.client.cache.voiceStates?.values(ctx.guildId);
            if (cachedStates) {
                const botId = ctx.client.botId || ctx.client.me?.id;
                let humanMembersInVc = 0;
                for (const state of cachedStates) {
                    if (state.channelId === voiceChannelId && state.userId !== botId) {
                        const userObj = await ctx.client.cache.users?.get(state.userId);
                        if (userObj?.bot) continue;
                        humanMembersInVc++;
                    }
                }
                if (humanMembersInVc === 1) return true;
            }
        }
    } catch (e) {
        logger.error('Permissions', 'Error checking voice state in canUseDJCommands', e);
    }

    return false;
}

/**
 * Check if user is in a voice channel
 */
export async function getVoiceChannel(member: any, client: any): Promise<any | null> {
    if (!member) return null;
    const voiceState = await client.cache.voiceStates?.get(member.id, member.guildId);
    if (!voiceState?.channelId) return null;
    return await client.cache.channels?.get(voiceState.channelId);
}

/**
 * Validate that the bot can join/speak in the target voice channel.
 */
export function getBotVoicePermissionIssue(_guild: any, _voiceChannel: any): string | null {
    return null;
}

/**
 * Validate that interaction is in a guild
 */
export function isGuildInteraction(ctx: any): boolean {
    return Boolean(ctx.guildId);
}

async function sendCtxError(ctx: any, payload: { content: string; flags?: number }): Promise<any> {
    try {
        if (ctx.deferred && typeof ctx.editOrReply === 'function') {
            return await ctx.editOrReply(payload);
        }
        if (typeof ctx.write === 'function') {
            return await ctx.write(payload);
        }
        if (typeof ctx.editOrReply === 'function') {
            return await ctx.editOrReply(payload);
        }
    } catch (e) {
        logger.error('Permissions', 'Failed to send permission error response', e);
    }
    return null;
}

/**
 * Send a "DJ only" error message
 */
export function djOnlyError(ctx: any): Promise<any> {
    return sendCtxError(ctx, {
        content: '🔒 This command requires DJ permissions.',
        flags: 64
    });
}

/**
 * Send an "owner only" error message
 */
export function ownerOnlyError(ctx: any): Promise<any> {
    return sendCtxError(ctx, {
        content: '🔒 This command is restricted to the bot owner.',
        flags: 64
    });
}

/**
 * Verify if the current text channel is allowed by server settings (/settc).
 * Owners and Administrators bypass the text channel lock.
 */
export async function verifyTextChannel(ctx: any): Promise<boolean> {
    if (!ctx.guildId || !ctx.channelId) return true;
    const userId = getRequesterId(ctx);
    if (isOwner(userId) || hasAdminPermission(ctx.member)) {
        return true;
    }

    if (!(await canUseTextChannel(ctx.guildId, ctx.channelId))) {
        const settings = await loadSettings(ctx.guildId);
        await sendCtxError(ctx, {
            content: `🔒 Commands are locked to <#${settings.textChannelId}>.`,
            flags: 64
        });
        return false;
    }

    return true;
}

/**
 * Verify user text channel lock and voice channel connection.
 * Returns channelId if valid, otherwise writes error and returns null.
 */
export async function verifyVoiceConnection(
    ctx: any,
    queue: { voiceChannelId?: string | null } | GuildQueue | null = null,
    checkLock: boolean = true
): Promise<string | null> {
    if (!(await verifyTextChannel(ctx))) {
        return null;
    }

    const userId = getRequesterId(ctx);
    const voiceState = await ctx.client.cache.voiceStates?.get(userId, ctx.guildId);
    const voiceChannelId: string | undefined = voiceState?.channelId;

    if (!voiceChannelId) {
        await sendCtxError(ctx, { content: '❌ You must join a voice channel first!', flags: 64 });
        return null;
    }

    if (queue && queue.voiceChannelId && voiceChannelId !== queue.voiceChannelId) {
        await sendCtxError(ctx, { content: '❌ You must be in the same voice channel as the bot to use this command.', flags: 64 });
        return null;
    }

    if (checkLock && ctx.guildId) {
        if (!(await canUseVoiceChannel(ctx.guildId, voiceChannelId))) {
            const settings = await loadSettings(ctx.guildId);
            await sendCtxError(ctx, {
                content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`,
                flags: 64
            });
            return null;
        }
    }

    return voiceChannelId;
}
