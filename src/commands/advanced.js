const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isGuildInteraction, isDJ, getVoiceChannel } = require('../utils/permissions');
const { formatDuration } = require('../utils/formatters');
const distubeService = require('../services/distube');

const commands = {
  // Seek to timestamp
  seek: {
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Jump to a specific timestamp in the current song.')
      .addStringOption(option =>
        option.setName('time')
          .setDescription('Timestamp (e.g., 1:30, 90, 2:15:30)')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];
      
      // Can not seek in streams
      if (song.isLive) {
        return interaction.reply({ content: 'Cannot seek in a live stream.', ephemeral: true });
      }

      const timeStr = interaction.options.getString('time');
      const seconds = parseTimestamp(timeStr);

      if (seconds === null) {
        return interaction.reply({ content: 'Invalid timestamp format. Use formats like: 1:30, 90, 2:15:30', ephemeral: true });
      }

      if (song.duration && seconds > song.duration) {
        return interaction.reply({ content: 'Cannot seek past song duration (' + formatDuration(song.duration) + ').', ephemeral: true });
      }

      await interaction.deferReply();

      try {
        queue.seek(seconds);
        return interaction.editReply('⏩ Seeked to **' + formatDuration(seconds) + '**');
      } catch (err) {
        return interaction.editReply('❌ Failed to seek: ' + err.message);
      }
    }
  },

  // Replay current song
  replay: {
    data: new SlashCommandBuilder()
      .setName('replay')
      .setDescription('Restart the current song from the beginning.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];

      // Check permissions
      const isRequester = song.user && song.user.id === interaction.user.id;
      if (!isRequester && !isDJ(interaction.member, client)) {
        return interaction.reply({ content: 'Only the requester or DJ can replay songs.', ephemeral: true });
      }

      await interaction.deferReply();

      try {
        queue.seek(0);
        return interaction.editReply('🔁 Replaying **' + song.name + '**');
      } catch (err) {
        return interaction.editReply('❌ Failed to replay: ' + err.message);
      }
    }
  },

  // Enhanced Now Playing with progress bar and embed
  nowplaying: {
    data: new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show detailed now playing info with progress bar.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];
      const elapsed = queue.currentTime || 0;
      
      const embed = new EmbedBuilder()
        .setColor(getSourceColor(song.source))
        .setTitle('🎵 Now Playing')
        .setDescription('**[' + song.name + '](' + song.url + ')**');

      // Add thumbnail if available
      if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
      }

      // Add progress bar for non-streams
      if (!song.isLive && song.duration) {
        const progress = Math.min(elapsed / song.duration, 1);
        const progressBar = createProgressBar(progress);
        embed.addFields({
          name: 'Progress',
          value: progressBar + '\n' + queue.formattedCurrentTime + ' / ' + song.formattedDuration,
          inline: false
        });
      } else if (song.isLive) {
        embed.addFields({
          name: 'Duration',
          value: ' LIVE',
          inline: true
        });
      }

      // Add metadata
      embed.addFields(
        { name: 'Requested by', value: song.user ? '<@' + song.user.id + '>' : 'Unknown', inline: true },
        { name: 'Source', value: getSourceEmoji(song.source) + ' ' + capitalizeFirst(song.source || 'youtube'), inline: true }
      );

      // Add queue info
      if (queue.songs.length > 1) {
        embed.addFields({
          name: 'Up Next',
          value: queue.songs[1].name,
          inline: false
        });
      }

      // Add status indicators
      const status = [];
      if (queue.repeatMode === 1) status.push('🔂 Loop Song');
      if (queue.repeatMode === 2) status.push('🔁 Loop Queue');
      if (queue.autoplay) status.push('📻 Autoplay');
      if (queue.volume !== 100) status.push('🔊 ' + queue.volume + '%');
      if (status.length > 0) {
        embed.setFooter({ text: status.join('  ') });
      }

      return interaction.reply({ embeds: [embed] });
    }
  },

  // Radio presets list
  radio: {
    data: new SlashCommandBuilder()
      .setName('radio')
      .setDescription('List available radio presets or play one.')
      .addStringOption(option =>
        option.setName('station')
          .setDescription('Station name to play')
          .setRequired(false)
          .addChoices(
            { name: '🎧 Lo-Fi Hip Hop', value: 'lofi' },
            { name: '🎷 Jazz', value: 'jazz' },
            { name: '🎻 Classical', value: 'classical' },
            { name: '☕ Chillhop', value: 'chillhop' },
            { name: '🌃 Synthwave', value: 'synthwave' },
            { name: '🎸 Rock', value: 'rock' },
            { name: '🎹 Electronic', value: 'electronic' },
            { name: '🌿 Ambient', value: 'ambient' },
            { name: '🎤 Hip Hop', value: 'hiphop' }
          )
      ),

    async execute(interaction, client) {
      const station = interaction.options.getString('station');

      if (!station) {
        // Show available stations
        const embed = new EmbedBuilder()
          .setTitle('📻 Radio Stations')
          .setColor(0x5865F2)
          .setDescription(
            '**Available Presets:**\n' +
            '🎧 lofi — Lo-Fi Hip Hop\n' +
            '🎷 jazz — Jazz Radio\n' +
            '🎻 classical — Classical Music\n' +
            '☕ chillhop — Chillhop Music\n' +
            '🌃 synthwave — Synthwave/Retrowave\n' +
            '🎸 rock — Rock Radio\n' +
            '🎹 electronic — Electronic/Techno\n' +
            '🌿 ambient — Ambient Chill\n' +
            '🎤 hiphop — Hip Hop Radio\n\n' +
            '*Use /play <station> or /radio <station> to tune in!*'
          );

        return interaction.reply({ embeds: [embed] });
      }

      // Play the radio station
      const voiceChannel = getVoiceChannel(interaction.member);
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
      }

      await interaction.deferReply();

      const presetUrl = distubeService.getRadioPreset(station);
      if (!presetUrl) {
        return interaction.editReply({ content: '❌ Unknown radio station.' });
      }

      try {
        await client.distube.play(voiceChannel, presetUrl, {
          textChannel: interaction.channel,
          member: interaction.member
        });
        return interaction.editReply('📻 Now playing **' + station + '** radio');
      } catch (err) {
        return interaction.editReply('❌ Failed to play radio: ' + err.message);
      }
    }
  }
};

// Helper functions
function parseTimestamp(str) {
  const parts = str.split(':').map(p => parseInt(p, 10));
  
  if (parts.some(isNaN)) return null;
  
  if (parts.length === 1) {
    return parts[0]; // Just seconds
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; // mm:ss
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; // hh:mm:ss
  }
  
  return null;
}

function createProgressBar(progress, length = 15) {
  const filled = Math.round(progress * length);
  const empty = length - filled;
  const head = '🔘';
  
  if (filled <= 0) {
    return head + '▬'.repeat(length - 1);
  }
  return '▬'.repeat(filled - 1) + head + '▬'.repeat(Math.max(0, empty));
}

function getSourceColor(source) {
  const colors = {
    youtube: 0xFF0000,
    spotify: 0x1DB954,
    soundcloud: 0xFF5500
  };
  return colors[source] || 0x5865F2;
}

function getSourceEmoji(source) {
  const emojis = {
    youtube: '🔴',
    spotify: '🟢',
    soundcloud: '🟠'
  };
  return emojis[source] || '🎵';
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = commands;
