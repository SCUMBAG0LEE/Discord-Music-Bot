/**
 * Permission checking utilities for DJ/Owner commands
 */

const { PermissionFlagsBits } = require('discord.js');
const { getEffectiveDJRole } = require('../services/serverSettings');

/**
 * Check if user is the bot owner
 * @param {string} userId
 * @param {object} client - Discord client with config
 * @returns {boolean}
 */
function isOwner(userId, client) {
  return client.config?.ownerId === userId;
}

/**
 * Check if user has DJ role (checks server-specific first, then global)
 * @param {import('discord.js').GuildMember} member
 * @param {object} client - Discord client with config
 * @returns {boolean}
 */
function isDJ(member, client) {
  if (isOwner(member.user.id, client)) return true;
  if (member.permissions.has('Administrator')) return true;
  if (member.permissions.has('ManageGuild')) return true;
  
  // Get effective DJ role (server-specific or global)
  const djRoleId = getEffectiveDJRole(member.guild.id, client.config?.djRoleId);
  
  if (!djRoleId) return true; // No DJ role set = everyone is DJ
  return member.roles.cache.has(djRoleId);
}

/**
 * Check if user is the track requester
 * @param {string} userId
 * @param {object} queue - DisTube queue
 * @returns {boolean}
 */
function isRequester(userId, queue) {
  const current = queue?.songs?.[0];
  if (!current) return false;
  return current.user?.id === userId || current.member?.id === userId;
}

/**
 * Check if user can use DJ-only commands
 * Returns true if: is owner, has DJ role, is alone in VC, or is the track requester
 * @param {import('discord.js').CommandInteraction} interaction
 * @param {object} client
 * @param {object} queue - DisTube queue
 * @returns {boolean}
 */
function canUseDJCommands(interaction, client, queue) {
  const member = interaction.member;
  
  // Owner always can
  if (isOwner(member.user.id, client)) return true;
  
  // Has DJ role
  if (isDJ(member, client)) return true;
  
  // Is track requester
  if (isRequester(member.user.id, queue)) return true;
  
  // Is alone in voice channel with bot
  const voiceChannel = member.voice.channel;
  if (voiceChannel) {
    const members = voiceChannel.members.filter(m => !m.user.bot);
    if (members.size === 1) return true;
  }
  
  return false;
}

/**
 * Check if user is in a voice channel
 * @param {import('discord.js').GuildMember} member
 * @returns {import('discord.js').VoiceChannel|null}
 */
function getVoiceChannel(member) {
  return member?.voice?.channel || null;
}

/**
 * Validate that the bot can join/speak in the target voice channel.
 * Returns null when everything looks valid, otherwise an actionable error string.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').VoiceBasedChannel} voiceChannel
 * @returns {string|null}
 */
function getBotVoicePermissionIssue(guild, voiceChannel) {
  const botMember = guild?.members?.me;
  if (!botMember) {
    return 'Could not resolve bot permissions in this server. Please try again.';
  }

  const perms = voiceChannel?.permissionsFor(botMember);
  if (!perms) {
    return `I cannot access ${voiceChannel}.`;
  }

  const missing = [];
  if (!perms.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
  if (!perms.has(PermissionFlagsBits.Connect)) missing.push('Connect');
  if (!perms.has(PermissionFlagsBits.Speak)) missing.push('Speak');

  if (missing.length > 0) {
    return `Missing permissions in ${voiceChannel}: ${missing.join(', ')}`;
  }

  // If channel is full and bot is not already inside, joining may fail.
  if (
    voiceChannel.userLimit > 0
    && voiceChannel.members.size >= voiceChannel.userLimit
    && !voiceChannel.members.has(botMember.id)
    && !perms.has(PermissionFlagsBits.MoveMembers)
  ) {
    return `${voiceChannel} is full. Free a slot or grant Move Members to the bot.`;
  }

  return null;
}

/**
 * Validate that interaction is in a guild
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {boolean}
 */
function isGuildInteraction(interaction) {
  return !!interaction.guild;
}

/**
 * Send a "DJ only" error message
 * @param {import('discord.js').CommandInteraction} interaction
 */
function djOnlyError(interaction) {
  return interaction.reply({
    content: '🔒 This command requires DJ permissions.',
    ephemeral: true
  });
}

/**
 * Send an "owner only" error message
 * @param {import('discord.js').CommandInteraction} interaction
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
  getVoiceChannel,
  getBotVoicePermissionIssue,
  isGuildInteraction,
  djOnlyError,
  ownerOnlyError
};
