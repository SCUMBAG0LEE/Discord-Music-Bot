const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { truncate, formatDuration } = require('../utils/formatters');

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
    
    // Use yt-dlp plugin for YouTube search
    let results;
    try {
      // Get the yt-dlp plugin stored on distube instance
      const ytdlpPlugin = client.distube.ytdlpPlugin;
      if (!ytdlpPlugin) {
        return interaction.editReply({ content: '❌ Search functionality not available (yt-dlp plugin not found)' });
      }
      
      results = await ytdlpPlugin.search(query, 10);
    } catch (err) {
      return interaction.editReply({ content: '❌ Search failed: ' + err.message });
    }

    if (!results || !results.length) {
      return interaction.editReply({ content: '🔍 No results found.' });
    }

    const options = results.slice(0, 10).map((video, index) => ({
      label: truncate(video.title || 'Unknown', 100),
      description: truncate(`${video.channel || 'Unknown'} • ${video.durationFormatted || formatDuration(video.duration)}`, 100),
      value: index.toString(),
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('search_select')
        .setPlaceholder('Select a video')
        .addOptions(options)
    );

    await interaction.editReply({ content: '🔍 Select a video from the list below:', components: [row] });

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
        // Defer the update first to avoid token expiration
        await i.deferUpdate();
        
        await client.distube.play(voiceChannel, selected.url, {
          textChannel: interaction.channel,
          member: interaction.member
        });
        
        // Edit the deferred interaction
        await i.editReply({ content: '▶️ Playing: **' + selected.title + '**', components: [] });
      } catch (err) {
        // If the interaction has already been responded to, use followUp instead
        try {
          await i.editReply({ content: '❌ Failed to play: ' + err.message, components: [] });
        } catch {
          await i.followUp({ content: '❌ Failed to play: ' + err.message, ephemeral: true }).catch(() => {});
        }
      }
    });

    collector.on('end', async (collected, reason) => {
      // Only show timeout message if no selection was made and it timed out
      if (collected.size === 0 && reason === 'time') {
        await interaction.editReply({ content: '⏱️ No selection made, please try again.', components: [] }).catch(() => {});
      }
    });
  }
};
