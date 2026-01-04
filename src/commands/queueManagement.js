const { SlashCommandBuilder } = require('discord.js');

const commands = {
  shuffle: {
    data: new SlashCommandBuilder()
      .setName('shuffle')
      .setDescription('Shuffle the queue'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || player.queue.length < 2) {
        return interaction.reply({ content: 'Not enough songs to shuffle.', ephemeral: true });
      }
      
      player.queue.shuffle();
      return interaction.reply(`🔀 Shuffled ${player.queue.length} tracks!`);
    }
  },

  clear: {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Clear the queue (keeps current track)'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
      }
      
      const count = player.queue.length;
      player.queue.clear();
      return interaction.reply(`🗑️ Cleared **${count}** tracks from the queue.`);
    }
  },

  remove: {
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a track from the queue')
      .addIntegerOption(option =>
        option.setName('position')
          .setDescription('Position to remove (2+)')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.length) {
        return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      }
      
      const pos = interaction.options.getInteger('position');
      const index = pos - 2; // Position 2 = index 0 in queue (1 is current)
      
      if (index >= player.queue.length) {
        return interaction.reply({ content: `Invalid position. Queue has ${player.queue.length + 1} tracks.`, ephemeral: true });
      }
      
      const removed = player.queue.splice(index, 1)[0];
      return interaction.reply(`🗑️ Removed **${removed.title}** from the queue.`);
    }
  },

  move: {
    data: new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move a track to a different position')
      .addIntegerOption(option =>
        option.setName('from')
          .setDescription('Current position')
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
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || player.queue.length < 2) {
        return interaction.reply({ content: 'Not enough tracks to move.', ephemeral: true });
      }
      
      const from = interaction.options.getInteger('from') - 2;
      const to = interaction.options.getInteger('to') - 2;
      
      if (from >= player.queue.length || to >= player.queue.length) {
        return interaction.reply({ content: 'Invalid positions.', ephemeral: true });
      }
      
      const [track] = player.queue.splice(from, 1);
      player.queue.splice(to, 0, track);
      
      return interaction.reply(`↔️ Moved **${track.title}** to position ${to + 2}.`);
    }
  },

  jump: {
    data: new SlashCommandBuilder()
      .setName('jump')
      .setDescription('Jump to a specific track in the queue')
      .addIntegerOption(option =>
        option.setName('position')
          .setDescription('Position to jump to')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.length) {
        return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      }
      
      const pos = interaction.options.getInteger('position');
      const index = pos - 2;
      
      if (index >= player.queue.length) {
        return interaction.reply({ content: 'Invalid position.', ephemeral: true });
      }
      
      // Remove tracks before target
      player.queue.splice(0, index);
      
      // Skip current to start playing target
      player.skip();
      
      return interaction.reply(`⏭️ Jumped to position ${pos}.`);
    }
  },

  skipto: {
    data: new SlashCommandBuilder()
      .setName('skipto')
      .setDescription('Skip to a specific track (alias for /jump)')
      .addIntegerOption(option =>
        option.setName('position')
          .setDescription('Position to skip to')
          .setRequired(true)
          .setMinValue(2)
      ),

    async execute(interaction, client) {
      // Just call jump
      return commands.jump.execute(interaction, client);
    }
  }
};

module.exports = commands;
