const { SlashCommandBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const { isGuildInteraction, isDJ } = require('../utils/permissions');
const { formatDuration } = require('../utils/formatters');

// Export multiple commands from this file
const commands = {
  // Now Playing
  np: {
    data: new SlashCommandBuilder()
      .setName('np')
      .setDescription('Display the currently playing song with details.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'No song is currently playing.' });
      }

      const song = queue.songs[0];
      let msg = `🎵 **Now Playing:** ${song.title}`;
      if (song.duration) msg += ` [${formatDuration(song.duration)}]`;
      msg += `\n👤 Requested by: <@${song.requester}>`;
      if (queue.loop) msg += '\n🔁 Looping enabled';
      
      return interaction.reply(msg);
    }
  },

  // Pause
  pause: {
    data: new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pause playback.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      player.pause(interaction.guildId);
      return interaction.reply('⏸️ Playback paused.');
    }
  },

  // Resume
  resume: {
    data: new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Resume playback.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      player.resume(interaction.guildId);
      return interaction.reply('▶️ Playback resumed.');
    }
  },

  // Stop
  stop: {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop playback, clear the queue, and disconnect.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      queueManager.delete(interaction.guildId);
      return interaction.reply('⏹️ Playback stopped and queue cleared.');
    }
  },

  // Volume
  volume: {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set playback volume (0.0 to 5.0).')
      .addNumberOption(option =>
        option.setName('level')
          .setDescription('Volume level (0.0 to 5.0)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(5)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      const level = interaction.options.getNumber('level');
      player.setVolume(interaction.guildId, level);
      
      const emoji = level === 0 ? '🔇' : level < 1 ? '🔈' : level < 2 ? '🔉' : '🔊';
      return interaction.reply(`${emoji} Volume set to ${level}`);
    }
  },

  // Loop
  loop: {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Toggle looping of the current song.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      const isLooping = player.toggleLoop(interaction.guildId);
      return interaction.reply(isLooping ? '🔁 Looping enabled.' : '➡️ Looping disabled.');
    }
  },

  // Skip (force)
  skip: {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Immediately skip the current song (DJ or requester only).'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'There is no song playing.' });
      }

      // Check permissions: requester or DJ
      if (queue.songs[0].requester !== interaction.user.id && !isDJ(interaction)) {
        return interaction.reply({ content: 'You do not have permission to skip directly. Use /voteskip instead.', ephemeral: true });
      }

      player.skip(interaction.guildId);
      return interaction.reply('⏭️ Song skipped.');
    }
  },

  // Vote Skip
  voteskip: {
    data: new SlashCommandBuilder()
      .setName('voteskip')
      .setDescription('Vote to skip the current song.'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'There is no song playing.' });
      }

      // Requester or DJ can skip immediately
      if (queue.songs[0].requester === interaction.user.id || isDJ(interaction)) {
        player.skip(interaction.guildId);
        return interaction.reply('⏭️ Song skipped.');
      }

      const { added, current, threshold } = queueManager.addVote(interaction.guildId, interaction.user.id);

      if (!added) {
        return interaction.reply({ content: 'You have already voted to skip this song.', ephemeral: true });
      }

      if (current >= threshold) {
        player.skip(interaction.guildId);
        return interaction.reply(`⏭️ Vote threshold reached (${current}/${threshold}). Skipping song.`);
      }

      return interaction.reply(`🗳️ Your vote has been registered. (${current}/${threshold} votes)`);
    }
  }
};

module.exports = commands;
