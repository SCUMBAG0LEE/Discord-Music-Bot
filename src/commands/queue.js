const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { formatDuration } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Display the current queue'),

  async execute(interaction, client) {
    const player = client.kazagumo.players.get(interaction.guildId);
    
    if (!player || (!player.queue.current && !player.queue.length)) {
      return interaction.reply({ content: 'The queue is empty.', ephemeral: true });
    }

    await interaction.deferReply();

    const itemsPerPage = 10;
    const queue = player.queue;
    const current = queue.current;
    
    // Build full list (current + queue)
    const allTracks = current ? [current, ...queue] : [...queue];
    const totalPages = Math.ceil(allTracks.length / itemsPerPage) || 1;
    let currentPage = 0;

    // Total duration
    const totalMs = allTracks.reduce((acc, t) => acc + (t.length || 0), 0);

    function generateEmbed(page) {
      const start = page * itemsPerPage;
      const pageTracks = allTracks.slice(start, start + itemsPerPage);
      
      const description = pageTracks.map((track, i) => {
        const pos = start + i + 1;
        const nowPlaying = pos === 1 && current ? ' 🎵' : '';
        return `**${pos}.** [${track.title}](${track.uri}) \`${formatDuration(track.length)}\`${nowPlaying}`;
      }).join('\n');

      return new EmbedBuilder()
        .setTitle('📋 Current Queue')
        .setDescription(description || 'Empty')
        .setColor(0x5865F2)
        .setFooter({ 
          text: `Page ${page + 1}/${totalPages} • ${allTracks.length} tracks • ${formatDuration(totalMs)} total • Volume: ${player.volume}%` 
        });
    }

    function createButtons(page) {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('queue_prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId('queue_next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      );
    }

    const message = await interaction.editReply({
      embeds: [generateEmbed(currentPage)],
      components: totalPages > 1 ? [createButtons(currentPage)] : []
    });

    if (totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'Not your buttons!', ephemeral: true });
      }

      if (i.customId === 'queue_prev') currentPage = Math.max(0, currentPage - 1);
      if (i.customId === 'queue_next') currentPage = Math.min(totalPages - 1, currentPage + 1);

      await i.update({
        embeds: [generateEmbed(currentPage)],
        components: [createButtons(currentPage)]
      });
    });

    collector.on('end', async () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('queue_prev').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('queue_next').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(true)
      );
      await interaction.editReply({ components: [disabledRow] }).catch(() => {});
    });
  }
};
