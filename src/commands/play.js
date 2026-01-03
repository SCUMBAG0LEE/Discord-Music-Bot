const { SlashCommandBuilder } = require('discord.js');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { logger } = require('../utils/logger');
const distubeService = require('../services/distube');

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

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const guildId = interaction.guildId;
    const requesterId = interaction.user.id;

    logger.command('play', requesterId, guildId, { query: query.substring(0, 100) });

    try {
      const distube = client.distube;
      
      // Check for radio preset first
      const presetUrl = distubeService.getRadioPreset(query);
      if (presetUrl) {
        logger.urlDetection(query, 'radio-preset');
        await distube.play(voiceChannel, presetUrl, {
          textChannel: interaction.channel,
          member: interaction.member
        });
        return interaction.editReply('📻 Playing radio: **' + query + '**');
      }

      // Check if it is a direct stream URL
      if (distubeService.isStreamUrl(query)) {
        logger.urlDetection(query, 'stream');
        await distube.play(voiceChannel, query, {
          textChannel: interaction.channel,
          member: interaction.member
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
        metadata: { replyMessage: replyMsg }
      });
      
      // The PLAY_SONG event will update the message to "Now playing"
      return;

    } catch (error) {
      logger.error('Play', 'Command failed for query: ' + query.substring(0, 50), error);
      return interaction.editReply({ content: '❌ Error: ' + error.message.slice(0, 200) });
    }
  }
};
