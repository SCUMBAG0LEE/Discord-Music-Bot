const { SlashCommandBuilder } = require('discord.js');
const { formatDuration, parseTimestamp } = require('../utils/formatters');

const commands = {
  pause: {
    data: new SlashCommandBuilder()
      .setName('pause')
      .setDescription('Pause playback'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.playing) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      player.pause(true);
      return interaction.reply('⏸️ Playback paused.');
    }
  },

  resume: {
    data: new SlashCommandBuilder()
      .setName('resume')
      .setDescription('Resume playback'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      player.pause(false);
      return interaction.reply('▶️ Playback resumed.');
    }
  },

  stop: {
    data: new SlashCommandBuilder()
      .setName('stop')
      .setDescription('Stop playback and disconnect'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
      }
      
      player.destroy();
      return interaction.reply('⏹️ Stopped and disconnected.');
    }
  },

  skip: {
    data: new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip the current song'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      player.skip();
      return interaction.reply('⏭️ Skipped.');
    }
  },

  volume: {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Set playback volume (0-200)')
      .addIntegerOption(option =>
        option.setName('level')
          .setDescription('Volume level')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(200)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
      }
      
      const level = interaction.options.getInteger('level');
      player.setVolume(level);
      
      const emoji = level === 0 ? '🔇' : level < 50 ? '🔈' : level < 100 ? '🔉' : '🔊';
      return interaction.reply(`${emoji} Volume set to **${level}%**`);
    }
  },

  seek: {
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Seek to a position (e.g., 1:30, 90)')
      .addStringOption(option =>
        option.setName('position')
          .setDescription('Timestamp to seek to')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const posStr = interaction.options.getString('position');
      const seconds = parseTimestamp(posStr);
      
      if (seconds === null) {
        return interaction.reply({ content: 'Invalid format. Use: 1:30, 90, or 2:15:30', ephemeral: true });
      }
      
      const ms = seconds * 1000;
      if (ms > player.queue.current.length) {
        return interaction.reply({ content: 'Cannot seek past track duration.', ephemeral: true });
      }
      
      player.seek(ms);
      return interaction.reply(`⏩ Seeked to **${formatDuration(ms)}**`);
    }
  },

  nowplaying: {
    data: new SlashCommandBuilder()
      .setName('nowplaying')
      .setDescription('Show current track info'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const track = player.queue.current;
      const position = player.position;
      
      // Progress bar
      const progress = position / track.length;
      const barLength = 15;
      const filled = Math.round(progress * barLength);
      const bar = '▬'.repeat(filled) + '🔘' + '▬'.repeat(Math.max(0, barLength - filled - 1));
      
      let msg = `🎵 **Now Playing**\n`;
      msg += `**[${track.title}](${track.uri})**\n`;
      msg += `${bar}\n`;
      msg += `${formatDuration(position)} / ${formatDuration(track.length)}\n`;
      msg += `👤 Requested by: ${track.requester}`;
      
      if (player.paused) msg += '\n⏸️ Paused';
      if (player.loop === 'track') msg += '\n🔂 Looping Track';
      if (player.loop === 'queue') msg += '\n🔁 Looping Queue';
      
      return interaction.reply(msg);
    }
  },

  loop: {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Toggle loop mode (off → track → queue → off)'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
      }
      
      // Cycle: none → track → queue → none
      const modes = ['none', 'track', 'queue'];
      const current = player.loop || 'none';
      const nextIndex = (modes.indexOf(current) + 1) % modes.length;
      const next = modes[nextIndex];
      
      player.setLoop(next);
      
      const messages = {
        'none': '➡️ Loop **disabled**',
        'track': '🔂 Looping **current track**',
        'queue': '🔁 Looping **queue**'
      };
      
      return interaction.reply(messages[next]);
    }
  },

  replay: {
    data: new SlashCommandBuilder()
      .setName('replay')
      .setDescription('Restart the current track'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      player.seek(0);
      return interaction.reply(`🔁 Replaying **${player.queue.current.title}**`);
    }
  },

  previous: {
    data: new SlashCommandBuilder()
      .setName('previous')
      .setDescription('Play the previous track'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player) {
        return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
      }
      
      if (!player.queue.previous) {
        return interaction.reply({ content: 'No previous track.', ephemeral: true });
      }
      
      player.play(player.queue.previous);
      return interaction.reply('⏮️ Playing previous track.');
    }
  }
};

module.exports = commands;
