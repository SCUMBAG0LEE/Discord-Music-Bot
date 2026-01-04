const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const os = require('os');
const { formatDuration } = require('../utils/formatters');

const commands = {
  help: {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show all available commands'),

    async execute(interaction, client) {
      const embed = new EmbedBuilder()
        .setTitle('🎵 Music Bot Commands')
        .setColor('#5865F2')
        .setDescription('A Discord music bot powered by Lavalink')
        .addFields(
          {
            name: '🎶 Playback',
            value: [
              '`/play` - Play a song or playlist',
              '`/pause` - Pause playback',
              '`/resume` - Resume playback',
              '`/stop` - Stop and disconnect',
              '`/skip` - Skip current track',
              '`/previous` - Play previous track',
              '`/seek` - Seek to position',
              '`/volume` - Adjust volume',
              '`/nowplaying` - Show current track',
              '`/loop` - Toggle loop mode',
              '`/replay` - Replay current track'
            ].join('\n'),
            inline: false
          },
          {
            name: '📋 Queue',
            value: [
              '`/queue` - Show the queue',
              '`/shuffle` - Shuffle the queue',
              '`/clear` - Clear the queue',
              '`/remove` - Remove a track',
              '`/move` - Move a track',
              '`/jump` - Jump to a track',
              '`/skipto` - Skip to a track'
            ].join('\n'),
            inline: false
          },
          {
            name: '🎛️ Filters',
            value: [
              '`/filter` - Apply audio filter',
              '`/clearfilter` - Clear all filters',
              '`/filters` - Show available filters',
              '`/speed` - Adjust playback speed',
              '`/pitch` - Adjust audio pitch'
            ].join('\n'),
            inline: false
          },
          {
            name: '🔧 Utility',
            value: [
              '`/help` - Show this message',
              '`/ping` - Check bot latency',
              '`/stats` - Bot statistics'
            ].join('\n'),
            inline: false
          }
        )
        .setFooter({ text: 'Powered by Lavalink' });
      
      return interaction.reply({ embeds: [embed] });
    }
  },

  ping: {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check bot and Lavalink latency'),

    async execute(interaction, client) {
      const start = Date.now();
      await interaction.deferReply();
      const latency = Date.now() - start;
      
      // Get Lavalink node info
      const node = client.kazagumo.shoukaku.nodes.get('Main');
      const lavalinkPing = node?.stats?.ping || 'N/A';
      
      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor('#00FF00')
        .addFields(
          { name: 'Bot Latency', value: `${latency}ms`, inline: true },
          { name: 'WebSocket', value: `${client.ws.ping}ms`, inline: true },
          { name: 'Lavalink', value: `${lavalinkPing}ms`, inline: true }
        );
      
      return interaction.editReply({ embeds: [embed] });
    }
  },

  stats: {
    data: new SlashCommandBuilder()
      .setName('stats')
      .setDescription('Show bot statistics'),

    async execute(interaction, client) {
      const node = client.kazagumo.shoukaku.nodes.get('Main');
      const nodeStats = node?.stats;
      
      // Bot stats
      const uptime = formatDuration(Math.floor(process.uptime() * 1000));
      const memUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
      const guilds = client.guilds.cache.size;
      const players = client.kazagumo.players.size;
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Bot Statistics')
        .setColor('#5865F2')
        .addFields(
          { name: '⏱️ Uptime', value: uptime, inline: true },
          { name: '💾 Memory', value: `${memUsage} MB`, inline: true },
          { name: '🏠 Servers', value: `${guilds}`, inline: true },
          { name: '🎵 Active Players', value: `${players}`, inline: true },
          { name: '📡 Node.js', value: process.version, inline: true },
          { name: '💻 Platform', value: `${os.platform()} ${os.arch()}`, inline: true }
        );
      
      // Lavalink stats if available
      if (nodeStats) {
        embed.addFields(
          { name: '\u200B', value: '**Lavalink Node**', inline: false },
          { name: 'Players', value: `${nodeStats.players}`, inline: true },
          { name: 'Playing', value: `${nodeStats.playingPlayers}`, inline: true },
          { name: 'Uptime', value: formatDuration(nodeStats.uptime), inline: true },
          { name: 'CPU Cores', value: `${nodeStats.cpu?.cores || 'N/A'}`, inline: true },
          { name: 'CPU Load', value: `${((nodeStats.cpu?.systemLoad || 0) * 100).toFixed(1)}%`, inline: true },
          { name: 'Memory', value: `${((nodeStats.memory?.used || 0) / 1024 / 1024).toFixed(0)} MB`, inline: true }
        );
      }
      
      return interaction.reply({ embeds: [embed] });
    }
  }
};

module.exports = commands;
