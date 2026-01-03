const BOT_OWNER_ID = process.env.BOT_OWNER_ID;
const DJ_ROLE_ID = process.env.DJ_ROLE_ID;

/**
 * Check if a member is a DJ or bot owner
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {boolean}
 */
function isDJ(interaction) {
  return interaction.user.id === BOT_OWNER_ID ||
         (DJ_ROLE_ID && interaction.member?.roles?.cache?.has(DJ_ROLE_ID));
}

/**
 * Check if the user is the bot owner
 * @param {string} userId
 * @returns {boolean}
 */
function isOwner(userId) {
  return userId === BOT_OWNER_ID;
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
 * Validate that interaction is in a guild
 * @param {import('discord.js').CommandInteraction} interaction
 * @returns {boolean}
 */
function isGuildInteraction(interaction) {
  return !!interaction.guild;
}

module.exports = {
  isDJ,
  isOwner,
  getVoiceChannel,
  isGuildInteraction,
  BOT_OWNER_ID,
  DJ_ROLE_ID
};
