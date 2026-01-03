const { SlashCommandBuilder } = require('discord.js');
const { RepeatMode } = require('distube');
const { isGuildInteraction, isDJ } = require('../utils/permissions');

// Export multiple commands from this file
const commands = {
  // Now Playing
  np: {
    data: new SlashCommandBuilder()
      .setName('np')
      .setDescription('Display the currently playing song with details.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) {
        return interaction.reply({ content: 'No song is currently playing.' });
      }

      const song = queue.songs[0];
      let msg = '🎵 **Now Playing:** ' + song.name;
      msg += ' [`' + song.formattedDuration + '`]';
      msg += '\n👤 Requested by: ' + (song.user ? '<@' + song.user.id + '>' : 'Unknown');
      msg += '\n⏱️ ' + queue.formattedCurrentTime + ' / ' + song.formattedDuration;
      if (queue.repeatMode === RepeatMode.SONG) msg += '\n🔂 Looping song';
      if (queue.repeatMode === RepeatMode.QUEUE) msg += '\n🔁 Looping queue';
      if (queue.autoplay) msg += '\n📻 Autoplay enabled';
      
      return interaction.reply(msg);
    }
  },

  // Pause
  pause: {
    data: new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pause playback.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      queue.pause();
      return interaction.reply('⏸️ Playback paused.');
    }
  },

  // Resume
  resume: {
    data: new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Resume playback.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      queue.resume();
      return interaction.reply('▶️ Playback resumed.');
    }
  },

  // Stop
  stop: {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop playback, clear the queue, and disconnect.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      await queue.stop();
      return interaction.reply('⏹️ Playback stopped and queue cleared.');
    }
  },

  // Volume
  volume: {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set playback volume (0 to 200).')
      .addIntegerOption(option =>
        option.setName('level')
          .setDescription('Volume level (0-200, default is 100)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(200)
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      const level = interaction.options.getInteger('level');
      queue.setVolume(level);
      
      const emoji = level === 0 ? '🔇' : level < 50 ? '🔈' : level < 100 ? '🔉' : '🔊';
      return interaction.reply(emoji + ' Volume set to **' + level + '%**');
    }
  },

  // Loop
  loop: {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Toggle loop mode (off -> song -> queue -> off).'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      const mode = queue.setRepeatMode();
      const modeText = ['➡️ Looping **disabled**', '🔂 Looping **current song**', '🔁 Looping **queue**'][mode];
      return interaction.reply(modeText);
    }
  },

  // Skip (force)
  skip: {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip the current song.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) {
        return interaction.reply({ content: 'There is no song playing.' });
      }

      // Check permissions: requester or DJ
      const song = queue.songs[0];
      const isRequester = song.user && song.user.id === interaction.user.id;
      if (!isRequester && !isDJ(interaction)) {
        return interaction.reply({ content: 'You do not have permission to skip directly. Use /voteskip instead.', ephemeral: true });
      }

      await queue.skip();
      return interaction.reply('⏭️ Song skipped.');
    }
  },

  // Vote Skip (simplified - DisTube does not have built-in vote system)
  voteskip: {
    data: new SlashCommandBuilder()
      .setName('voteskip')
      .setDescription('Vote to skip the current song.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs.length) {
        return interaction.reply({ content: 'There is no song playing.' });
      }

      // Requester or DJ can skip immediately
      const song = queue.songs[0];
      const isRequester = song.user && song.user.id === interaction.user.id;
      if (isRequester || isDJ(interaction)) {
        await queue.skip();
        return interaction.reply('⏭️ Song skipped.');
      }

      // For voting, we use a simple implementation with queue metadata
      if (!queue.votes) queue.votes = new Set();
      
      if (queue.votes.has(interaction.user.id)) {
        return interaction.reply({ content: 'You have already voted to skip this song.', ephemeral: true });
      }
      
      queue.votes.add(interaction.user.id);
      
      // Calculate threshold (50% of voice channel members)
      const voiceChannel = queue.voice.channel;
      const members = voiceChannel.members.filter(m => !m.user.bot).size;
      const threshold = Math.ceil(members / 2);
      const current = queue.votes.size;
      
      if (current >= threshold) {
        queue.votes.clear();
        await queue.skip();
        return interaction.reply('⏭️ Vote threshold reached (' + current + '/' + threshold + '). Skipping song.');
      }

      return interaction.reply('🗳️ Your vote has been registered. (' + current + '/' + threshold + ' votes)');
    }
  },

  // Previous - play previous song
  previous: {
    data: new SlashCommandBuilder()
      .setName('previous')
      .setDescription('Play the previous song.'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      if (!queue.previousSongs || queue.previousSongs.length === 0) {
        return interaction.reply({ content: 'No previous song available.', ephemeral: true });
      }

      try {
        await queue.previous();
        return interaction.reply('⏮️ Playing previous song.');
      } catch (err) {
        return interaction.reply({ content: '❌ Could not play previous song: ' + err.message, ephemeral: true });
      }
    }
  },

  // Filters - audio filters
  filters: {
    data: new SlashCommandBuilder()
      .setName('filters')
      .setDescription('Apply audio filters to the playback.')
      .addStringOption(option =>
        option.setName('filter')
          .setDescription('Filter to apply')
          .setRequired(true)
          .addChoices(
            { name: '🔇 Clear All Filters', value: 'clear' },
            { name: '🎸 Bass Boost', value: 'bassboost' },
            { name: '🎺 3D', value: '3d' },
            { name: '🌀 Vaporwave', value: 'vaporwave' },
            { name: '🐿️ Nightcore', value: 'nightcore' },
            { name: '🔊 Echo', value: 'echo' },
            { name: '🔁 Reverse', value: 'reverse' },
            { name: '🎵 Karaoke', value: 'karaoke' },
            { name: '🔉 Surround', value: 'surround' },
            { name: '🐢 Slow', value: 'slow' },
            { name: '⚡ Speed Up', value: 'fast' }
          )
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      const filter = interaction.options.getString('filter');
      
      try {
        if (filter === 'clear') {
          // DisTube v5 uses filters.clear() or setting filters to empty array
          queue.filters.clear();
          return interaction.reply('🔇 All filters cleared.');
        }

        // Toggle filter
        if (queue.filters.has(filter)) {
          queue.filters.remove(filter);
          return interaction.reply('🎛️ Filter **' + filter + '** disabled.');
        } else {
          queue.filters.add(filter);
          return interaction.reply('🎛️ Filter **' + filter + '** enabled.');
        }
      } catch (err) {
        return interaction.reply({ content: '❌ Could not apply filter: ' + err.message, ephemeral: true });
      }
    }
  }
};

module.exports = commands;
