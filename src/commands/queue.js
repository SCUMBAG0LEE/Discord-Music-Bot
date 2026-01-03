const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const { isGuildInteraction } = require('../utils/permissions');
const { formatDuration } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display the current song queue.'),

  async execute(interaction) {
    if (!isGuildInteraction(interaction)) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const queue = queueManager.get(interaction.guildId);
    if (!queue || queue.songs.length === 0) {
      return interaction.reply({ content: 'The queue is empty.' });
    }

    await interaction.deferReply();

    const itemsPerPage = 10;
    const totalPages = Math.ceil(queue.songs.length / itemsPerPage);
    let currentPage = 0;

    function generateEmbed(page) {
      const start = page * itemsPerPage;
      const currentSongs = queue.songs.slice(start, start + itemsPerPage);
      
      const description = currentSongs.map((song, index) => {
        const position = start + index + 1;
        const url = song.sourceUrl || song.url;
        const nowPlaying = position === 1 ? ' 🎵' : '';
        const duration = song.duration ? ` [${formatDuration(song.duration)}]` : '';
        return `**${position}.** [${song.title}](${url})${duration}${nowPlaying}`;
      }).join('\n');

      return new EmbedBuilder()
        .setTitle('🎶 Current Queue')
        .setDescription(description)
        .setColor(0x5865F2)
        .setFooter({ text: `Page ${page + 1} of ${totalPages} • ${queue.songs.length} songs` });
    }

    function createButtons(page) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('queue_prev')
          .setLabel('◀ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('queue_next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      );
    }

    await interaction.editReply({
      embeds: [generateEmbed(currentPage)],
      components: [createButtons(currentPage)]
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'These buttons aren\'t for you!', ephemeral: true });
      }

      if (i.customId === 'queue_prev') {
        currentPage = Math.max(0, currentPage - 1);
      } else if (i.customId === 'queue_next') {
        currentPage = Math.min(totalPages - 1, currentPage + 1);
      }

      await i.update({
        embeds: [generateEmbed(currentPage)],
        components: [createButtons(currentPage)]
      });
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('queue_prev')
          .setLabel('◀ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId('queue_next')
          .setLabel('Next ▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );
      
      await interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  }
};
