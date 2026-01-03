const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
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
    
    // Use DisTube search
    let results;
    try {
      results = await client.distube.search(query, { limit: 5 });
    } catch (err) {
      return interaction.editReply({ content: 'Search failed: ' + err.message });
    }

    if (!results.length) {
      return interaction.editReply({ content: 'No results found.' });
    }

    const options = results.map((video, index) => ({
      label: truncate(video.name, 100),
      description: truncate(video.uploader?.name || 'Unknown', 100),
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
      time: 30000,
    });

    collector.on('collect', async i => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'This is not your selection!', ephemeral: true });
      }

      const selected = results[parseInt(i.values[0])];
      
      try {
        await client.distube.play(voiceChannel, selected, {
          textChannel: interaction.channel,
          member: interaction.member
        });
        await i.update({ content: '▶️ Playing: **' + selected.name + '**', components: [] });
      } catch (err) {
        await i.update({ content: '❌ Failed to play: ' + err.message, components: [] });
      }
    });

    collector.on('end', async collected => {
      if (collected.size === 0) {
        await interaction.editReply({ content: '⏱️ No selection made, please try again.', components: [] }).catch(() => {});
      }
    });
  }
};
