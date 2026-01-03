const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const youtubeService = require('../services/youtube');
const { isGuildInteraction, isDJ } = require('../utils/permissions');
const { formatDuration } = require('../utils/formatters');

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

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];
      
      // Can't seek in streams or SoundCloud
      if (song.isStream || song.source === 'stream') {
        return interaction.reply({ content: 'Cannot seek in a live stream.', ephemeral: true });
      }
      
      if (song.source === 'soundcloud') {
        return interaction.reply({ content: 'Seeking is not supported for SoundCloud tracks.', ephemeral: true });
      }

      const timeStr = interaction.options.getString('time');
      const seconds = parseTimestamp(timeStr);

      if (seconds === null) {
        return interaction.reply({ content: 'Invalid timestamp format. Use formats like: `1:30`, `90`, `2:15:30`', ephemeral: true });
      }

      if (song.duration && seconds > song.duration) {
        return interaction.reply({ content: `Cannot seek past song duration (${formatDuration(song.duration)}).`, ephemeral: true });
      }

      await interaction.deferReply();

      const success = await player.seekTo(interaction.guildId, seconds);

      if (success) {
        return interaction.editReply(`⏩ Seeked to **${formatDuration(seconds)}**`);
      } else {
        return interaction.editReply('❌ Failed to seek. Try again.');
      }
    }
  },

  // Replay current song
  replay: {
    data: new SlashCommandBuilder()
      .setName('replay')
      .setDescription('Restart the current song from the beginning.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];

      // Check permissions
      if (song.requester !== interaction.user.id && !isDJ(interaction)) {
        return interaction.reply({ content: 'Only the requester or DJ can replay songs.', ephemeral: true });
      }

      await interaction.deferReply();

      // Replay by seeking to 0 or restarting
      const success = await player.replay(interaction.guildId);

      if (success) {
        return interaction.editReply(`🔄 Replaying **${song.title}**`);
      } else {
        return interaction.editReply('❌ Failed to replay. Try again.');
      }
    }
  },

  // Enhanced Now Playing with progress bar and embed
  nowplaying: {
    data: new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show detailed now playing info with progress bar.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.', ephemeral: true });
      }

      const song = queue.songs[0];
      const elapsed = queue.nowPlayingStart ? Math.floor((Date.now() - queue.nowPlayingStart) / 1000) : 0;
      
      const embed = new EmbedBuilder()
        .setColor(getSourceColor(song.source))
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${song.title}](${song.sourceUrl || song.url})**`);

      // Add thumbnail if available
      if (song.thumbnail) {
        embed.setThumbnail(song.thumbnail);
      }

      // Add progress bar for non-streams
      if (!song.isStream && song.duration) {
        const progress = Math.min(elapsed / song.duration, 1);
        const progressBar = createProgressBar(progress);
        embed.addFields({
          name: 'Progress',
          value: `${progressBar}\n\`${formatDuration(elapsed)} / ${formatDuration(song.duration)}\``,
          inline: false
        });
      } else if (song.isStream) {
        embed.addFields({
          name: 'Duration',
          value: '🔴 LIVE',
          inline: true
        });
      }

      // Add metadata
      embed.addFields(
        { name: 'Requested by', value: `<@${song.requester}>`, inline: true },
        { name: 'Source', value: getSourceEmoji(song.source) + ' ' + capitalizeFirst(song.source || 'youtube'), inline: true }
      );

      // Add queue info
      if (queue.songs.length > 1) {
        embed.addFields({
          name: 'Up Next',
          value: `${queue.songs[1].title}`,
          inline: false
        });
      }

      // Add status indicators
      const status = [];
      if (queue.loop) status.push('🔁 Loop');
      if (queue.autoplay) status.push('📻 Autoplay');
      if (queue.twentyFourSeven) status.push('🌙 24/7');
      if (queue.volume !== 1.0) status.push(`🔊 ${Math.round(queue.volume * 100)}%`);
      if (status.length > 0) {
        embed.setFooter({ text: status.join(' • ') });
      }

      return interaction.reply({ embeds: [embed] });
    }
  },

  // Autoplay toggle
  autoplay: {
    data: new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Toggle autoplay - automatically queue related songs.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.', ephemeral: true });
      }

      queue.autoplay = !queue.autoplay;
      
      if (queue.autoplay) {
        return interaction.reply('✅ Autoplay **enabled** — Related songs will be added when the queue ends.');
      } else {
        return interaction.reply('❌ Autoplay **disabled**');
      }
    }
  },

  // 24/7 mode toggle
  twentyfourseven: {
    data: new SlashCommandBuilder()
      .setName('247')
      .setDescription('Toggle 24/7 mode - bot stays in voice channel.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      // Only DJ can toggle 24/7 mode
      if (!isDJ(interaction)) {
        return interaction.reply({ content: 'Only DJs can toggle 24/7 mode.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.', ephemeral: true });
      }

      queue.twentyFourSeven = !queue.twentyFourSeven;
      
      if (queue.twentyFourSeven) {
        // Clear any existing idle timer
        if (queue.idleTimer) {
          clearTimeout(queue.idleTimer);
          queue.idleTimer = null;
        }
        return interaction.reply('✅ 24/7 mode **enabled** — Bot will stay in voice channel.');
      } else {
        return interaction.reply('❌ 24/7 mode **disabled** — Bot will leave after 1 minute of inactivity.');
      }
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
            { name: '🎵 Lo-Fi Hip Hop', value: 'lofi' },
            { name: '🎷 Jazz', value: 'jazz' },
            { name: '🎻 Classical', value: 'classical' },
            { name: '☕ Chillhop', value: 'chillhop' },
            { name: '🌆 Synthwave', value: 'synthwave' }
          )
      ),

    async execute(interaction) {
      const station = interaction.options.getString('station');

      if (!station) {
        // Show available stations
        const embed = new EmbedBuilder()
          .setTitle('📻 Radio Stations')
          .setColor(0x5865F2)
          .setDescription(
            '**Available Presets:**\n' +
            '🎵 `lofi` — Lo-Fi Hip Hop\n' +
            '🎷 `jazz` — Jazz Radio\n' +
            '🎻 `classical` — Classical Music\n' +
            '☕ `chillhop` — Chillhop Music\n' +
            '🌆 `synthwave` — Synthwave/Retrowave\n\n' +
            '*Use `/play <station>` or `/radio <station>` to tune in!*'
          );

        return interaction.reply({ embeds: [embed] });
      }

      // Redirect to play command logic
      // We'll manually invoke the play handler here
      const radioService = require('../services/radio');
      const { getVoiceChannel } = require('../utils/permissions');
      
      const voiceChannel = getVoiceChannel(interaction.member);
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
      }

      await interaction.deferReply();

      const { song, error } = await radioService.getStream(station, interaction.user.id);
      
      if (error) {
        return interaction.editReply({ content: error });
      }

      const queue = queueManager.getOrCreate(interaction.guildId, voiceChannel);
      const wasEmpty = queue.songs.length === 0;
      
      queueManager.addSongs(interaction.guildId, song);

      if (wasEmpty) {
        player.playSong(interaction.guildId, song);
        return interaction.editReply(`📻 Now playing **${song.title}**`);
      } else {
        return interaction.editReply(`📻 Added **${song.title}** to queue`);
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
    soundcloud: 0xFF5500,
    stream: 0x5865F2
  };
  return colors[source] || 0x5865F2;
}

function getSourceEmoji(source) {
  const emojis = {
    youtube: '▶️',
    spotify: '💚',
    soundcloud: '🟠',
    stream: '📻'
  };
  return emojis[source] || '🎵';
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = commands;
