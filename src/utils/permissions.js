// Local definition of standard Discord permission bits to avoid framework export version issues
export const PermissionFlagsBits = {
  Administrator: 8n,
  ManageGuild: 32n
};

import { getEffectiveDJRole } from '../services/serverSettings.js';

/**
 * Check if user is the bot owner
 * @param {string} userId
 * @returns {boolean}
 */
export function isOwner(userId) {
  return process.env.BOT_OWNER_ID === userId;
}

/**
 * Check if user has DJ role (checks server-specific first, then global)
 * @param {object} member - Seyfert GuildMember object
 * @returns {Promise<boolean>}
 */
export async function isDJ(member) {
  if (isOwner(member.id)) return true;
  
  const permissions = member.permissions;
  if (permissions.has([PermissionFlagsBits.Administrator])) return true;
  if (permissions.has([PermissionFlagsBits.ManageGuild])) return true;
  
  // Get effective DJ role (server-specific or global)
  const djRoleId = await getEffectiveDJRole(member.guildId, process.env.DJ_ROLE_ID);
  
  if (!djRoleId) return true; // No DJ role set = everyone is DJ
  return member.roles.keys.includes(djRoleId);
}

/**
 * Check if user is the track requester
 * @param {string} userId
 * @param {object} queue - MusicManager queue
 * @returns {boolean}
 */
export function isRequester(userId, queue) {
  const current = queue?.songs?.[0];
  if (!current) return false;
  return current.requesterId === userId;
}

/**
 * Check if user can use DJ-only commands
 * Returns true if: is owner, has DJ role, is alone in VC, or is the track requester
 * @param {object} ctx - Seyfert CommandContext
 * @param {object} queue - MusicManager queue
 * @returns {Promise<boolean>}
 */
export async function canUseDJCommands(ctx, queue) {
  const member = ctx.member;
  if (!member) return false;
  
  // Owner always can
  if (isOwner(member.id)) return true;
  
  // Has DJ role
  if (await isDJ(member)) return true;
  
  // Is track requester
  if (isRequester(member.id, queue)) return true;
  
  // Is alone in voice channel with bot
  try {
    const voiceState = await ctx.client.cache.voiceStates?.get(member.id, ctx.guildId);
    const voiceChannelId = voiceState?.channelId;
    if (voiceChannelId) {
      const cachedStates = await ctx.client.cache.voiceStates?.values(ctx.guildId);
      if (cachedStates) {
        const botId = ctx.client.botId || ctx.client.me?.id;
        const membersInVc = cachedStates.filter(state => state.channelId === voiceChannelId && state.userId !== botId);
        if (membersInVc.length === 1) return true; // Only the user is in VC (excluding bot)
      }
    }
  } catch (e) {
    console.error("Error checking voice state in canUseDJCommands:", e);
  }
  
  return false;
}

/**
 * Check if user is in a voice channel
 * @param {object} member
 * @param {object} client
 * @returns {Promise<object|null>}
 */
export async function getVoiceChannel(member, client) {
  const voiceState = await client.cache.voiceStates?.get(member.id, member.guildId);
  if (!voiceState?.channelId) return null;
  return await client.cache.channels?.get(voiceState.channelId);
}

/**
 * Validate that the bot can join/speak in the target voice channel.
 * Returns null when everything looks valid, otherwise an actionable error string.
 * @param {object} guild
 * @param {object} voiceChannel
 * @returns {string|null}
 */
export function getBotVoicePermissionIssue(guild, voiceChannel) {
  // Seyfert handles connection errors gracefully inside joinVoiceChannel.
  // We return null here to delegate connection checks to the connection handler.
  return null;
}

/**
 * Validate that interaction is in a guild
 * @param {object} ctx
 * @returns {boolean}
 */
export function isGuildInteraction(ctx) {
  return !!ctx.guildId;
}

/**
 * Send a "DJ only" error message
 * @param {object} ctx
 */
export function djOnlyError(ctx) {
  return ctx.write({
    content: '🔒 This command requires DJ permissions.',
    flags: 64
  });
}

/**
 * Send an "owner only" error message
 * @param {object} ctx
 */
export function ownerOnlyError(ctx) {
  return ctx.write({
    content: '🔒 This command is restricted to the bot owner.',
    flags: 64
  });
}

/**
 * Verify user voice channel connection.
 * @param {object} ctx - Seyfert context
 * @param {object} queue - Active queue (optional)
 * @param {boolean} checkLock - Whether to check server-specific VC lock settings
 * @returns {Promise<string|null>} - Returns channelId if valid, otherwise writes error and returns null
 */
export async function verifyVoiceConnection(ctx, queue = null, checkLock = true) {
  const voiceState = await ctx.client.cache.voiceStates?.get(ctx.member.id, ctx.guildId);
  const voiceChannelId = voiceState?.channelId;
  
  if (!voiceChannelId) {
    await ctx.write({ content: '❌ You must join a voice channel first!', flags: 64 });
    return null;
  }
  
  if (queue && queue.voiceChannelId && voiceChannelId !== queue.voiceChannelId) {
    await ctx.write({ content: '❌ You must be in the same voice channel as the bot to use this command.', flags: 64 });
    return null;
  }
  
  if (checkLock) {
    const { canUseVoiceChannel, loadSettings } = await import('../services/serverSettings.js');
    if (!await canUseVoiceChannel(ctx.guildId, voiceChannelId)) {
      const settings = await loadSettings(ctx.guildId);
      await ctx.write({ 
        content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
        flags: 64 
      });
      return null;
    }
  }
  
  return voiceChannelId;
}

