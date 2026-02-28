const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { truncate, formatDuration } = require('../utils/formatters');
const { loadSettings, canUseVoiceChannel } = require('../services/serverSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search YouTube or SoundCloud and choose a track interactively.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search term')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('platform')
        .setDescription('Which platform to search (default: YouTube)')
        .setRequired(false)
        .addChoices(
          { name: 'YouTube', value: 'youtube' },
          { name: 'SoundCloud', value: 'soundcloud' }
        )
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
    if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
      const settings = loadSettings(interaction.guildId);
      return interaction.reply({ 
        content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const platform = interaction.options.getString('platform') || 'youtube';
    
    // Use yt-dlp plugin for search
    let results;
    try {
      // Get the yt-dlp plugin stored on distube instance
      const ytdlpPlugin = client.distube.ytdlpPlugin;
      if (!ytdlpPlugin) {
        return interaction.editReply({ content: '❌ Search functionality not available (yt-dlp plugin not found)' });
      }
      
      results = platform === 'soundcloud'
        ? await ytdlpPlugin.searchSoundCloud(query, 10)
        : await ytdlpPlugin.search(query, 10);
    } catch (err) {
      return interaction.editReply({ content: '❌ Search failed: ' + err.message });
    }

    if (!results || !results.length) {
      return interaction.editReply({ content: '🔍 No results found.' });
    }

    const platformLabel = platform === 'soundcloud' ? '🟠 SoundCloud' : '🔴 YouTube';

    const options = results.slice(0, 10).map((video, index) => ({
      label: truncate(video.title || 'Unknown', 100),
      description: truncate(`${video.channel || 'Unknown'} • ${video.durationFormatted || formatDuration(video.duration)}`, 100),
      value: index.toString(),
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('search_select')
        .setPlaceholder('Select a track')
        .addOptions(options)
    );

    await interaction.editReply({ content: `${platformLabel} — Select a track from the list below:`, components: [row] });

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
