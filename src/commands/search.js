const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { formatDuration } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search for a song and choose from results')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Search query')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const query = interaction.options.getString('query');
    const member = interaction.member;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({ content: '❌ You need to be in a voice channel.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      // Search YouTube
      const result = await client.kazagumo.search(query, { requester: interaction.user });

      if (!result || !result.tracks.length) {
        return interaction.editReply('❌ No results found.');
      }

      // Take first 10 results
      const tracks = result.tracks.slice(0, 10);

      // Create select menu
      const options = tracks.map((track, i) => ({
        label: track.title.slice(0, 100),
        description: `${track.author?.slice(0, 50) || 'Unknown'} • ${formatDuration(track.length)}`,
        value: i.toString()
      }));

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('search_select')
        .setPlaceholder('Select a song to play')
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setTitle(`🔍 Search results for: ${query}`)
        .setColor('#5865F2')
        .setDescription(
          tracks.map((t, i) => 
            `**${i + 1}.** [${t.title}](${t.uri}) \`${formatDuration(t.length)}\``
          ).join('\n')
        )
        .setFooter({ text: 'Select a song from the dropdown below • Expires in 30s' });

      const response = await interaction.editReply({ embeds: [embed], components: [row] });

      // Wait for selection
      const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 30000,
        max: 1
      });

      collector.on('collect', async i => {
        const selected = parseInt(i.values[0]);
        const track = tracks[selected];

        // Get or create player
        let player = client.kazagumo.players.get(interaction.guildId);
        
        if (!player) {
          player = await client.kazagumo.createPlayer({
            guildId: interaction.guildId,
            textId: interaction.channelId,
            voiceId: voiceChannel.id,
            volume: client.config.defaultVolume,
            deaf: true
          });
        }

        // Add track
        player.queue.add(track);

        // Start playing if not already
        if (!player.playing && !player.paused) {
          player.play();
        }

        await i.update({
          content: `✅ Added **${track.title}** to the queue.`,
          embeds: [],
          components: []
        });
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time' && collected.size === 0) {
          interaction.editReply({ 
            content: '⏱️ Search timed out.',
            embeds: [],
            components: []
          }).catch(() => {});
        }
      });

    } catch (error) {
      console.error('Search error:', error);
      return interaction.editReply('❌ An error occurred while searching.');
    }
  }
};
