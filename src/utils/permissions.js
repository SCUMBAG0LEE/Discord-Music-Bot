/**
 * Permission checking utilities for DJ/Owner commands
 */

const { getEffectiveDJRole } = require('../services/serverSettings');

/**
 * Check if user is the bot owner
 */
function isOwner(userId, client) {
  return client.config.ownerId === userId;
}

/**
 * Check if user has DJ role (checks server-specific first, then global)
 */
function isDJ(member, client) {
  if (isOwner(member.user.id, client)) return true;
  if (member.permissions.has('Administrator')) return true;
  if (member.permissions.has('ManageGuild')) return true;
  
  // Get effective DJ role (server-specific or global)
  const djRoleId = getEffectiveDJRole(member.guild.id, client.config.djRoleId);
  
  if (!djRoleId) return true; // No DJ role set = everyone is DJ
  return member.roles.cache.has(djRoleId);
}

/**
 * Check if user is the track requester
 */
function isRequester(userId, player) {
  const current = player.queue.current;
  if (!current) return false;
  return current.requester?.id === userId;
}

/**
 * Check if user can use DJ-only commands
 * Returns true if: is owner, has DJ role, is alone in VC, or is the track requester
 */
function canUseDJCommands(interaction, client, player) {
  const member = interaction.member;
  
  // Owner always can
  if (isOwner(member.user.id, client)) return true;
  
  // Has DJ role
  if (isDJ(member, client)) return true;
  
  // Is track requester
  if (isRequester(member.user.id, player)) return true;
  
  // Is alone in voice channel with bot
  const voiceChannel = member.voice.channel;
  if (voiceChannel) {
    const members = voiceChannel.members.filter(m => !m.user.bot);
    if (members.size === 1) return true;
  }
  
  return false;
}

/**
 * Send a "DJ only" error message
 */
function djOnlyError(interaction) {
  return interaction.reply({
    content: '🔒 This command requires DJ permissions.',
    ephemeral: true
  });
}

/**
 * Send an "owner only" error message
 */
function ownerOnlyError(interaction) {
  return interaction.reply({
    content: '🔒 This command is restricted to the bot owner.',
    ephemeral: true
  });
}

module.exports = {
  isOwner,
  isDJ,
  isRequester,
  canUseDJCommands,
  djOnlyError,
  ownerOnlyError
};
