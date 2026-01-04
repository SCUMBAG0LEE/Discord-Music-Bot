const { SlashCommandBuilder } = require('discord.js');
const { isGuildInteraction, isDJ } = require('../utils/permissions');

const commands = {
  // Shuffle
  shuffle: {
    data: new SlashCommandBuilder()
      .setName('shuffle')
      .setDescription('Shuffle the queue (except the current song).'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'Not enough songs in the queue to shuffle.' });
      }

      try {
        queue.shuffle();
        return interaction.reply('🔀 Queue shuffled! (' + (queue.songs.length - 1) + ' songs)');
      } catch (err) {
        return interaction.reply({ content: '❌ Failed to shuffle: ' + err.message, ephemeral: true });
      }
    }
  },

  // Clear
  clear: {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear the queue (except the currently playing song).'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'There is no active queue.' });
      }

      // Check permission for clearing
      if (!isDJ(interaction.member, client)) {
        return interaction.reply({ content: 'Only DJs can clear the queue.', ephemeral: true });
      }

      // Keep only the current song (index 0), remove everything else
      const removedCount = queue.songs.length - 1;
      if (removedCount > 0) {
        queue.songs.splice(1);
        return interaction.reply('🗑️ Cleared **' + removedCount + '** songs from the queue.');
      }
      return interaction.reply({ content: 'Queue is already empty (only current song playing).', ephemeral: true });
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

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'No songs available to remove.' });
      }

      const index = interaction.options.getInteger('index');
      if (index > queue.songs.length) {
        return interaction.reply({ content: 'Invalid index. Queue only has ' + queue.songs.length + ' songs.', ephemeral: true });
      }

      const songToRemove = queue.songs[index - 1];
      
      // Check permissions: requester of the song being removed, or DJ
      const isRequester = songToRemove.user && songToRemove.user.id === interaction.user.id;
      if (!isRequester && !isDJ(interaction.member, client)) {
        return interaction.reply({ content: 'You can only remove songs you requested.', ephemeral: true });
      }

      const removed = queue.songs.splice(index - 1, 1)[0];
      if (removed) {
        return interaction.reply('🗑️ Removed **' + removed.name + '** from the queue.');
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

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length < 3) {
        return interaction.reply({ content: 'Not enough songs in the queue to move.' });
      }

      const from = interaction.options.getInteger('from');
      const to = interaction.options.getInteger('to');

      if (from > queue.songs.length || to > queue.songs.length) {
        return interaction.reply({ content: 'Invalid positions. Queue only has ' + queue.songs.length + ' songs.', ephemeral: true });
      }

      // Remove from old position and insert at new position
      const [song] = queue.songs.splice(from - 1, 1);
      queue.songs.splice(to - 1, 0, song);
      
      return interaction.reply('↔️ Moved **' + song.name + '** from position ' + from + ' to ' + to + '.');
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

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'There are no songs to jump to.' });
      }

      const index = interaction.options.getInteger('index');
      if (index > queue.songs.length) {
        return interaction.reply({ content: 'Invalid index. Queue only has ' + queue.songs.length + ' songs.', ephemeral: true });
      }

      const targetSong = queue.songs[index - 1];
      
      try {
        await queue.jump(index - 1);
        return interaction.reply('⏭️ Jumping to **' + targetSong.name + '**.');
      } catch (err) {
        return interaction.reply({ content: '❌ Failed to jump: ' + err.message, ephemeral: true });
      }
    }
  },

  // Skip To (alias for jump)
  skipto: {
    data: new SlashCommandBuilder()
      .setName('skipto')
      .setDescription('Skip to a specific song in the queue (alias for /jump).')
      .addIntegerOption(option =>
        option.setName('position')
          .setDescription('Position in queue to skip to')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length < 2) {
        return interaction.reply({ content: 'There are no songs to skip to.' });
      }

      const position = interaction.options.getInteger('position');
      if (position > queue.songs.length) {
        return interaction.reply({ content: 'Invalid position. Queue only has ' + queue.songs.length + ' songs.', ephemeral: true });
      }

      const targetSong = queue.songs[position - 1];
      
      try {
        await queue.jump(position - 1);
        return interaction.reply('⏭️ Skipped to **' + targetSong.name + '**.');
      } catch (err) {
        return interaction.reply({ content: '❌ Failed to skip: ' + err.message, ephemeral: true });
      }
    }
  }
};

module.exports = commands;
