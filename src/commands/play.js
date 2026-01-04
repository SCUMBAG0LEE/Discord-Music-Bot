const { SlashCommandBuilder } = require('discord.js');
const { formatDuration } = require('../utils/formatters');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music from YouTube, Spotify, SoundCloud, or search')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL or search term')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    const member = interaction.member;
    const voiceChannel = member?.voice?.channel;
    
    if (!voiceChannel) {
      return interaction.reply({ content: 'You must be in a voice channel!', ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const kazagumo = client.kazagumo;

    try {
      // Get or create player
      let player = kazagumo.players.get(interaction.guildId);
      
      if (!player) {
        player = await kazagumo.createPlayer({
          guildId: interaction.guildId,
          textId: interaction.channelId,
          voiceId: voiceChannel.id,
          volume: 100,
          deaf: true
        });
      }

      // Search for tracks
      const result = await kazagumo.search(query, { requester: interaction.user });

      if (!result.tracks.length) {
        return interaction.editReply('❌ No results found.');
      }

      // Handle playlist vs single track
      if (result.type === 'PLAYLIST') {
        for (const track of result.tracks) {
          player.queue.add(track);
        }
        await interaction.editReply(`✅ Added playlist **${result.playlistName}** (${result.tracks.length} tracks)`);
      } else {
        const track = result.tracks[0];
        player.queue.add(track);
        
        if (player.playing) {
          await interaction.editReply(`✅ Added to queue: **${track.title}** - \`${formatDuration(track.length)}\``);
        } else {
          await interaction.editReply(`🎵 Now playing: **${track.title}** - \`${formatDuration(track.length)}\``);
        }
      }

      // Start playing if not already
      if (!player.playing && !player.paused) {
        player.play();
      }

    } catch (error) {
      console.error('Play error:', error);
      return interaction.editReply(`❌ Error: ${error.message?.slice(0, 200) || 'Unknown error'}`);
    }
  }
};
