const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const youtubeService = require('../services/youtube');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { truncate } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube and choose a video interactively.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search term')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!isGuildInteraction(interaction)) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const voiceChannel = getVoiceChannel(interaction.member);
    if (!voiceChannel) {
      return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const results = await youtubeService.search(query, 5);

    if (!results.length) {
      return interaction.editReply({ content: 'No results found.' });
    }

    const options = results.map((video, index) => ({
      label: truncate(video.title, 100),
      description: truncate(video.author?.name || 'Unknown', 100),
      value: index.toString(),
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('search_select')
        .setPlaceholder('Select a video')
        .addOptions(options)
    );

    await interaction.editReply({ content: 'Select a video from the list below:', components: [row] });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 15000,
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'This is not your selection!', ephemeral: true });
      }

      const selected = results[parseInt(i.values[0])];
      const song = {
        title: selected.title,
        url: selected.url,
        duration: selected.seconds || 0,
        requester: interaction.user.id,
        source: 'youtube',
        sourceUrl: selected.url
      };

      const queue = queueManager.getOrCreate(interaction.guildId, voiceChannel);
      const wasEmpty = queue.songs.length === 0;
      
      queueManager.addSongs(interaction.guildId, song);

      if (wasEmpty) {
        player.playSong(interaction.guildId, song);
        await i.update({ content: `Now playing: **${song.title}**`, components: [] });
      } else {
        await i.update({ content: `Added to queue: **${song.title}**`, components: [] });
      }
    });

    collector.on('end', async collected => {
      if (collected.size === 0) {
        await interaction.editReply({ content: 'No selection made, please try again.', components: [] });
      }
    });
  }
};
