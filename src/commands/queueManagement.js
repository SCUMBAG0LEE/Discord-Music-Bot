const { SlashCommandBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const { isGuildInteraction } = require('../utils/permissions');

const commands = {
  // Shuffle
  shuffle: {
    data: new SlashCommandBuilder()
      .setName('shuffle')
      .setDescription('Shuffle the queue (except the current song).'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'Not enough songs in the queue to shuffle.' });
      }

      queueManager.shuffle(interaction.guildId);
      return interaction.reply('🔀 Queue shuffled.');
    }
  },

  // Clear
  clear: {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear the queue (except the currently playing song).'),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      queueManager.clearQueue(interaction.guildId);
      return interaction.reply('🗑️ Cleared the queue (except the currently playing song).');
    }
  },

  // Remove
  remove: {
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a song from the queue by its position (not the currently playing one).')
      .addIntegerOption(option =>
        option.setName('index')
          .setDescription('Position in queue (starting at 2)')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'No songs available to remove.' });
      }

      const index = interaction.options.getInteger('index');
      if (index > queue.songs.length) {
        return interaction.reply({ content: `Invalid index. Queue only has ${queue.songs.length} songs.`, ephemeral: true });
      }

      const removed = queueManager.removeSong(interaction.guildId, index - 1);
      if (removed) {
        return interaction.reply(`🗑️ Removed **${removed.title}** from the queue.`);
      }
      return interaction.reply({ content: 'Could not remove song.', ephemeral: true });
    }
  },

  // Move
  move: {
    data: new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move a song in the queue from one position to another.')
      .addIntegerOption(option =>
        option.setName('from')
          .setDescription('Current position (starting at 2)')
          .setRequired(true)
          .setMinValue(2)
      )
      .addIntegerOption(option =>
        option.setName('to')
          .setDescription('New position')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length < 3) {
        return interaction.reply({ content: 'Not enough songs in the queue to move.' });
      }

      const from = interaction.options.getInteger('from');
      const to = interaction.options.getInteger('to');

      if (from > queue.songs.length || to > queue.songs.length) {
        return interaction.reply({ content: `Invalid positions. Queue only has ${queue.songs.length} songs.`, ephemeral: true });
      }

      const moved = queueManager.moveSong(interaction.guildId, from - 1, to - 1);
      if (moved) {
        return interaction.reply(`↕️ Moved **${moved.title}** from position ${from} to ${to}.`);
      }
      return interaction.reply({ content: 'Could not move song.', ephemeral: true });
    }
  },

  // Jump
  jump: {
    data: new SlashCommandBuilder()
      .setName('jump')
      .setDescription('Jump to a specific song in the queue (skipping intermediate songs).')
      .addIntegerOption(option =>
        option.setName('index')
          .setDescription('Position in queue (starting at 2)')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'There are no songs to jump to.' });
      }

      const index = interaction.options.getInteger('index');
      if (index > queue.songs.length) {
        return interaction.reply({ content: `Invalid index. Queue only has ${queue.songs.length} songs.`, ephemeral: true });
      }

      const targetSong = queue.songs[index - 1];
      queueManager.jumpTo(interaction.guildId, index - 1);
      player.skip(interaction.guildId);
      
      return interaction.reply(`⏭️ Jumping to **${targetSong.title}**.`);
    }
  }
};

module.exports = commands;
