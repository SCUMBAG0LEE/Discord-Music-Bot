const { SlashCommandBuilder } = require('discord.js');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { logger } = require('../utils/logger');
const distubeService = require('../services/distube');
const { loadSettings, canUseVoiceChannel } = require('../services/serverSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play from YouTube, Spotify, SoundCloud, or a direct URL/stream.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL, search term, or radio preset (lofi, jazz, classical, chillhop, synthwave)')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    if (!isGuildInteraction(interaction)) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const voiceChannel = getVoiceChannel(interaction.member);
    if (!voiceChannel) {
      return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
    }

    // Check voice channel lock
    const settings = loadSettings(interaction.guildId);
    if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
      return interaction.reply({ 
        content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const guildId = interaction.guildId;
    const requesterId = interaction.user.id;

    logger.command('play', requesterId, guildId, { query: query.substring(0, 100) });

    try {
      const distube = client.distube;
      
      // Determine queue position based on queue type (fair queue support)
      let position = undefined;
      if (settings.queueType === 'fair') {
        const queue = distube.getQueue(guildId);
        if (queue && queue.songs.length > 1) {
          position = calculateFairPosition(queue, requesterId);
        }
      }
      
      // Check for radio preset first
      const presetUrl = distubeService.getRadioPreset(query);
      if (presetUrl) {
        logger.urlDetection(query, 'radio-preset');
        await distube.play(voiceChannel, presetUrl, {
          textChannel: interaction.channel,
          member: interaction.member,
          position
        });
        return interaction.editReply('📻 Playing radio: **' + query + '**');
      }

      // Check if it is a direct stream URL
      if (distubeService.isStreamUrl(query)) {
        logger.urlDetection(query, 'stream');
        await distube.play(voiceChannel, query, {
          textChannel: interaction.channel,
          member: interaction.member,
          position
        });
        return interaction.editReply('📡 Playing stream');
      }

      // Let DisTube handle everything else (YouTube, Spotify, SoundCloud, search)
      logger.urlDetection(query, 'distube-auto');
      
      // Send initial "processing" message and store it for later editing
      const replyMsg = await interaction.editReply('🔍 Processing: **' + query.substring(0, 100) + '**...');
      
      await distube.play(voiceChannel, query, {
        textChannel: interaction.channel,
        member: interaction.member,
        position,
        metadata: { 
          replyMessage: replyMsg,
          maxDuration: settings.maxDuration // Pass max duration for validation in event handler
        }
      });
      
      // The PLAY_SONG event will update the message to "Now playing"
      return;

    } catch (error) {
      logger.error('Play', 'Command failed for query: ' + query.substring(0, 50), error);
      return interaction.editReply({ content: '❌ Error: ' + error.message.slice(0, 200) });
    }
  }
};

/**
 * Calculate the fair queue position for a user
 * Fair queue alternates between users to prevent queue domination
 */
function calculateFairPosition(queue, userId) {
  // Get all unique requesters in order
  const songs = queue.songs;
  if (songs.length <= 1) return undefined;
  
  // Find the last song by this user
  let lastUserSongIndex = -1;
  for (let i = songs.length - 1; i >= 0; i--) {
    if (songs[i].member?.id === userId) {
      lastUserSongIndex = i;
      break;
    }
  }
  
  // If user has no songs in queue, add at the end
  if (lastUserSongIndex === -1) {
    return undefined; // Default position (end)
  }
  
  // Find the next slot after another user's song
  for (let i = lastUserSongIndex + 1; i < songs.length; i++) {
    if (songs[i].member?.id !== userId) {
      return i + 1; // Insert after this song
    }
  }
  
  // No interleaving possible, add at end
  return undefined;
}
