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
      if (!isRequester && !isDJ(interaction.member, client)) {
        return interaction.reply({ content: 'You do not have permission to skip directly. Use /voteskip instead.', ephemeral: true });
      }

      await queue.skip();
      return interaction.reply('⏭️ Song skipped.');
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
  }
};

module.exports = commands;
