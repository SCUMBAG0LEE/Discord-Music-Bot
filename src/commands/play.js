const { SlashCommandBuilder } = require('discord.js');
const { formatDuration } = require('../utils/formatters');
const { loadSettings, canUseVoiceChannel } = require('../services/serverSettings');

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

    // Check voice channel lock
    if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
      const settings = loadSettings(interaction.guildId);
      return interaction.reply({ 
        content: `❌ Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const kazagumo = client.kazagumo;
    const maxQueue = client.config.maxQueueSize;
    const settings = loadSettings(interaction.guildId);

    try {
      // Get or create player
      let player = kazagumo.players.get(interaction.guildId);
      
      if (!player) {
        player = await kazagumo.createPlayer({
          guildId: interaction.guildId,
          textId: interaction.channelId,
          voiceId: voiceChannel.id,
          volume: client.config.defaultVolume,
          deaf: true
        });
      }

      // Check max queue size (0 = unlimited)
      if (maxQueue > 0 && player.queue.length >= maxQueue) {
        return interaction.editReply(`❌ Queue is full (max ${maxQueue} tracks).`);
      }

      // Search for tracks
      const result = await kazagumo.search(query, { requester: interaction.user });

      if (!result.tracks.length) {
        return interaction.editReply('❌ No results found.');
      }

      // Max duration check helper (0 = unlimited)
      const maxDuration = client.config.maxDuration || 0;
      const isTooLong = (track) => maxDuration > 0 && track.length > maxDuration * 1000;
      
      // Fair queue helper - find position to insert for fair distribution
      const getFairPosition = (queue, requesterId) => {
        if (settings.queueType !== 'fair' || queue.length === 0) return queue.length;
        
        // Find the last track by this user
        let lastUserTrackIndex = -1;
        for (let i = queue.length - 1; i >= 0; i--) {
          if (queue[i]?.requester?.id === requesterId) {
            lastUserTrackIndex = i;
            break;
          }
        }
        
        if (lastUserTrackIndex === -1) {
          // User has no tracks, add at the end
          return queue.length;
        }
        
        // Find next position after the user's last track where another user's track is
        // This ensures fair rotation
        for (let i = lastUserTrackIndex + 1; i < queue.length; i++) {
          if (queue[i]?.requester?.id !== requesterId) {
            return i;
          }
        }
        
        return queue.length;
      };

      // Handle playlist vs single track
      if (result.type === 'PLAYLIST') {
        let added = 0;
        let skipped = 0;
        for (const track of result.tracks) {
          // Check queue limit for each track (0 = unlimited)
          if (maxQueue > 0 && player.queue.length >= maxQueue) break;
          // Check duration limit
          if (isTooLong(track)) { skipped++; continue; }
          
          // Use fair position for fair queue mode
          if (settings.queueType === 'fair') {
            const pos = getFairPosition(player.queue, interaction.user.id);
            player.queue.splice(pos, 0, track);
          } else {
            player.queue.add(track);
          }
          added++;
        }
        let msg = `✅ Added **${added}** tracks from **${result.playlistName}**`;
        if (skipped > 0) msg += ` (${skipped} skipped - too long)`;
        if (maxQueue > 0 && player.queue.length >= maxQueue) msg += ` (queue full)`;
        if (settings.queueType === 'fair') msg += ` 🔄`;
        await interaction.editReply(msg);
      } else {
        const track = result.tracks[0];
        
        // Check duration limit
        if (isTooLong(track)) {
          return interaction.editReply(`❌ Track is too long (max ${maxDuration}s).`);
        }
        
        // Use fair position for fair queue mode
        if (settings.queueType === 'fair' && player.queue.length > 0) {
          const pos = getFairPosition(player.queue, interaction.user.id);
          player.queue.splice(pos, 0, track);
          
          if (player.playing) {
            await interaction.editReply(`✅ Added to queue (position ${pos + 2}): **${track.title}** - \`${formatDuration(track.length)}\` 🔄`);
          } else {
            await interaction.editReply(`🎵 Now playing: **${track.title}** - \`${formatDuration(track.length)}\``);
          }
        } else {
          player.queue.add(track);
          
          if (player.playing) {
            await interaction.editReply(`✅ Added to queue: **${track.title}** - \`${formatDuration(track.length)}\``);
          } else {
            await interaction.editReply(`🎵 Now playing: **${track.title}** - \`${formatDuration(track.length)}\``);
          }
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
