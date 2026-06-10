const { SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const { isGuildInteraction, isOwner } = require('../utils/permissions');
const { logger } = require('../utils/logger');
const { formatDuration } = require('../utils/formatters');
const os = require('os');

const commands = {
  // Help
  help: {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show help for available commands.')
      .addStringOption(opt =>
        opt.setName('category')
          .setDescription('Show help for a specific category')
          .addChoices(
            { name: '🎶 Playing Music', value: 'playing' },
            { name: '⏯️ Playback', value: 'playback' },
            { name: '📋 Queue', value: 'queue' },
            { name: '💾 Playlists', value: 'playlists' },
            { name: '🎛️ Filters', value: 'filters' },
            { name: '⚙️ Settings', value: 'settings' },
            { name: '🔧 Admin', value: 'admin' }
          )
      ),

    async execute(interaction, client) {
      const category = interaction.options.getString('category');
      
      if (category) {
        return showCategoryHelp(interaction, category);
      }
      
      const helpEmbed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎵 Music Bot Commands')
        .addFields([
          {
            name: '🎶 Playing Music',
            value: '`/play` - Play from URL or search\n`/search` - Interactive search\n`/playnext` - Add to play next\n`/forceplay` - Play immediately (DJ)',
            inline: true
          },
          {
            name: '⏯️ Playback Control',
            value: '`/pause` `/resume` `/stop`\n`/volume` - Set volume (0-200)\n`/seek` - Jump to timestamp\n`/replay` - Restart song',
            inline: true
          },
          {
            name: '⏭️ Skipping',
            value: '`/forceskip` - Force skip (DJ)\n`/voteskip` - Vote to skip\n`/previous` - Previous song\n`/jump` - Jump to position',
            inline: true
          },
          {
            name: '📋 Queue',
            value: '`/queue` - View queue\n`/nowplaying` - Now playing\n`/shuffle` `/clear`\n`/remove` `/move`',
            inline: true
          },
          {
            name: '💾 Playlists',
            value: '`/savelist` - Save queue\n`/loadlist` - Load playlist\n`/playlists` - Your playlists\n`/appendlist` - Add to playlist',
            inline: true
          },
          {
            name: '⚙️ Settings & Effects',
            value: '`/loop` - Toggle loop\n`/autoplay` - Auto-queue songs\n`/247` - Stay in channel\n`/filter` - Audio effects',
            inline: true
          },
          {
            name: '🔧 Utility',
            value: '`/help` - Commands\n`/ping` - Latency\n`/stats` - Bot statistics\n`/lyrics` - Song lyrics',
            inline: true
          }
        ])
        .setFooter({ text: 'Use /help <category> for more details • Supports YouTube, Spotify, SoundCloud, Bandcamp, Vimeo & more!' });

      return interaction.reply({ embeds: [helpEmbed] });
    }
  },

  // Refresh Commands (Owner only)
  refreshcommands: {
    data: new SlashCommandBuilder()
      .setName('refreshcommands')
      .setDescription('Remove all global commands (Bot Owner only).'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
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
  },

  // Ping command
  ping: {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check bot latency'),

    async execute(interaction, client) {
      const start = Date.now();
      await interaction.deferReply();
      const latency = Date.now() - start;
      const wsPing = client.ws.ping;
      
      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor('#00FF00')
        .addFields(
          { name: 'Bot Latency', value: `${latency}ms`, inline: true },
          { name: 'Websocket Ping', value: wsPing === -1 ? 'Calculating...' : `${wsPing}ms`, inline: true },
          { name: 'API Time', value: `${Date.now() - start}ms`, inline: true }
        );
      
      return interaction.editReply({ embeds: [embed] });
    }
  },

  // Stats command
  stats: {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show bot statistics'),

    async execute(interaction, client) {
      // Bot stats
      const uptime = formatDuration(Math.floor(process.uptime()));
      const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
      const guilds = client.guilds.cache.size;
      const queues = client.distube.queues.size;
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Bot Statistics')
        .setColor('#5865F2')
        .addFields(
          { name: '⏱️ Uptime', value: uptime, inline: true },
          { name: '💾 Memory', value: `${memUsage} MB`, inline: true },
          { name: '🏠 Servers', value: `${guilds}`, inline: true },
          { name: '🎵 Active Queues', value: `${queues}`, inline: true },
          { name: '📡 Node.js', value: process.version, inline: true },
          { name: '💻 Platform', value: `${os.platform()} ${os.arch()}`, inline: true }
        )
        .setFooter({ text: 'Powered by DisTube + yt-dlp' });
      
      return interaction.reply({ embeds: [embed] });
    }
  }
};

/**
 * Show detailed help for a specific category
 */
async function showCategoryHelp(interaction, category) {
  const embeds = {
    playing: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎶 Playing Music Commands')
      .addFields([
        { name: '/play <query>', value: 'Play a song from YouTube, Spotify, SoundCloud, or a direct URL' },
        { name: '/search <query>', value: 'Search for songs and select from results' },
        { name: '/playnext <query>', value: 'Add a song to play next in queue' },
        { name: '/forceplay <query>', value: 'Play immediately, skipping current song (DJ only)' },
        { name: '/radio', value: 'Play from preset radio stations (lofi, jazz, etc.)' }
      ]),
      
    playback: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⏯️ Playback Commands')
      .addFields([
        { name: '/pause', value: 'Pause the current song' },
        { name: '/resume', value: 'Resume playback' },
        { name: '/stop', value: 'Stop and clear the queue' },
        { name: '/volume <0-200>', value: 'Set the playback volume' },
        { name: '/seek <time>', value: 'Jump to a specific time (e.g., 1:30)' },
        { name: '/replay', value: 'Restart the current song' },
        { name: '/forceskip', value: 'Force skip the current song (DJ only)' },
        { name: '/voteskip', value: 'Vote to skip the current song' }
      ]),
      
    queue: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('📋 Queue Commands')
      .addFields([
        { name: '/queue', value: 'View the current queue' },
        { name: '/nowplaying', value: 'Show the currently playing song' },
        { name: '/shuffle', value: 'Shuffle the queue' },
        { name: '/clear', value: 'Clear the queue' },
        { name: '/remove <position>', value: 'Remove a song from the queue' },
        { name: '/move <from> <to>', value: 'Move a song in the queue' },
        { name: '/jump <position>', value: 'Jump to a specific position' },
        { name: '/previous', value: 'Play the previous song' }
      ]),
      
    playlists: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('💾 Playlist Commands')
      .addFields([
        { name: '/savelist <name>', value: 'Save the current queue as a playlist' },
        { name: '/loadlist <name>', value: 'Load a saved playlist' },
        { name: '/playlists', value: 'View your saved playlists' },
        { name: '/appendlist <name>', value: 'Add current queue to existing playlist' },
        { name: '/deletelist <name>', value: 'Delete a saved playlist' }
      ]),
      
    filters: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('🎛️ Filter Commands')
      .addFields([
        { name: '/filter <preset>', value: 'Apply an audio filter (bassboost, nightcore, etc.)' },
        { name: '/clearfilter', value: 'Remove all active filters' },
        { name: '/filters', value: 'View available filters and active ones' }
      ])
      .setFooter({ text: 'Available filters: bassboost, nightcore, vaporwave, 3d, tremolo, vibrato, karaoke, treble, subboost, phaser' }),
      
    settings: new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('⚙️ Settings Commands')
      .addFields([
        { name: '/settings', value: 'View or change music settings' },
        { name: '/loop <off/song/queue>', value: 'Set loop mode' },
        { name: '/autoplay', value: 'Toggle autoplay (related songs)' },
        { name: '/247', value: 'Toggle 24/7 mode (stay in voice channel)' }
      ]),
      
    admin: new EmbedBuilder()
      .setColor(0xFF6B6B)
      .setTitle('🔧 Admin Commands')
      .setDescription('These commands require Administrator permission or DJ role.')
      .addFields([
        { name: '/settc <channel>', value: 'Restrict bot commands to a specific text channel' },
        { name: '/setvc <channel>', value: 'Restrict bot to a specific voice channel' },
        { name: '/setdjrole <role>', value: 'Set the DJ role for this server' },
        { name: '/queuetype <linear/fair>', value: 'Set queue type (fair alternates between users)' },
        { name: '/skipratio <0.0-1.0>', value: 'Set vote skip percentage required' },
        { name: '/maxduration <seconds>', value: 'Set maximum song duration' },
        { name: '/serversettings', value: 'View all server settings' },
        { name: '/forceremove', value: 'Force remove songs from queue' }
      ])
  };
  
  const embed = embeds[category];
  if (!embed) {
    return interaction.reply({ content: 'Unknown category.', ephemeral: true });
  }
  
  return interaction.reply({ embeds: [embed] });
}

module.exports = commands;
