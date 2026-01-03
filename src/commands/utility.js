const { SlashCommandBuilder, REST, Routes } = require('discord.js');
const { isGuildInteraction, isOwner } = require('../utils/permissions');
const { logger } = require('../utils/logger');

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
            value: '`/play` - Play from URL or search\n`/search` - Interactive search\n`/radio` - Radio station presets',
            inline: true
          },
          {
            name: '⏯️ Playback Control',
            value: '`/pause` `/resume` `/stop`\n`/volume` - Set volume (0-5)\n`/seek` - Jump to timestamp\n`/replay` - Restart song',
            inline: true
          },
          {
            name: '⏭️ Skipping',
            value: '`/skip` - Force skip (DJ)\n`/voteskip` - Vote to skip\n`/jump` - Jump to position',
            inline: true
          },
          {
            name: '📋 Queue',
            value: '`/queue` - View queue\n`/nowplaying` - Now playing\n`/shuffle` `/clear`\n`/remove` `/move`',
            inline: true
          },
          {
            name: '💾 Playlists',
            value: '`/savelist` - Save queue\n`/loadlist` - Load playlist\n`/playlists` - Your playlists\n`/deletelist` - Delete playlist',
            inline: true
          },
          {
            name: '⚙️ Settings',
            value: '`/loop` - Toggle loop\n`/autoplay` - Auto-queue songs\n`/247` - Stay in channel',
            inline: true
          }
        ],
        footer: {
          text: 'Supports YouTube, Spotify, SoundCloud & Radio streams!'
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
        logger.error('Utility', 'Error refreshing commands', error);
        return interaction.reply({ content: 'There was an error refreshing commands.', ephemeral: true });
      }
    }
  }
};

module.exports = commands;
