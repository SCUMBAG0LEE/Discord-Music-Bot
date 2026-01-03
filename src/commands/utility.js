const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { isGuildInteraction, isOwner } = require('../utils/permissions');

const commands = {
  // Help
  help: {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show help for available commands.'),

    async execute(interaction) {
      const helpEmbed = {
        color: 0x5865F2,
        title: '🎵 Music Bot Commands',
        fields: [
          {
            name: '🎶 Playing Music',
            value: '`/play` - Play from URL or search\n`/search` - Interactive search',
            inline: true
          },
          {
            name: '⏯️ Playback Control',
            value: '`/pause` - Pause\n`/resume` - Resume\n`/stop` - Stop & disconnect\n`/volume` - Set volume (0-5)',
            inline: true
          },
          {
            name: '⏭️ Skipping',
            value: '`/skip` - Force skip (DJ/requester)\n`/voteskip` - Vote to skip\n`/jump` - Jump to position',
            inline: true
          },
          {
            name: '📋 Queue',
            value: '`/queue` - View queue\n`/np` - Now playing\n`/shuffle` - Shuffle queue\n`/clear` - Clear queue',
            inline: true
          },
          {
            name: '✏️ Queue Editing',
            value: '`/remove` - Remove song\n`/move` - Move song',
            inline: true
          },
          {
            name: '🔁 Other',
            value: '`/loop` - Toggle loop\n`/help` - This message',
            inline: true
          }
        ],
        footer: {
          text: 'Supports YouTube & Spotify links!'
        }
      };

      return interaction.reply({ embeds: [helpEmbed] });
    }
  },

  // Refresh Commands (Owner only)
  refreshcommands: {
    data: new SlashCommandBuilder()
      .setName('refreshcommands')
      .setDescription('Remove all global commands (Bot Owner only).'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: 'Only the bot owner can refresh commands.', ephemeral: true });
      }

      try {
        const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        return interaction.reply('✅ All global commands have been removed. Changes may take up to an hour to propagate.');
      } catch (error) {
        console.error('Error refreshing commands:', error);
        return interaction.reply({ content: 'There was an error refreshing commands.', ephemeral: true });
      }
    }
  }
};

module.exports = commands;
