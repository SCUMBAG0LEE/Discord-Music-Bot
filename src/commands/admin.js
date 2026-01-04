const { SlashCommandBuilder, EmbedBuilder, ChannelType } = require('discord.js');
const { isDJ, isOwner, djOnlyError, ownerOnlyError } = require('../utils/permissions');
const { loadSettings, setSetting } = require('../services/serverSettings');
const { getPlaylist, listPlaylists } = require('../services/playlists');

const commands = {
  forceremove: {
    data: new SlashCommandBuilder()
      .setName('forceremove')
      .setDescription('Remove tracks from queue by position or user (DJ only)')
      .addSubcommand(sub =>
        sub.setName('position')
          .setDescription('Remove a track at specific position')
          .addIntegerOption(opt =>
            opt.setName('pos')
              .setDescription('Queue position to remove (2+)')
              .setRequired(true)
              .setMinValue(2)
          )
      )
      .addSubcommand(sub =>
        sub.setName('user')
          .setDescription('Remove all tracks added by a user')
          .addUserOption(opt =>
            opt.setName('target')
              .setDescription('User whose tracks to remove')
              .setRequired(true)
          )
      ),

    async execute(interaction, client) {
      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }

      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player || !player.queue.length) {
        return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'position') {
        const pos = interaction.options.getInteger('pos');
        const index = pos - 2; // Position 2 = index 0 in queue (1 is current)
        
        if (index >= player.queue.length) {
          return interaction.reply({ content: `Invalid position. Queue has ${player.queue.length + 1} tracks.`, ephemeral: true });
        }
        
        const removed = player.queue.splice(index, 1)[0];
        return interaction.reply(`🗑️ Force removed **${removed.title}** (requested by ${removed.requester})`);
      }

      if (sub === 'user') {
        const target = interaction.options.getUser('target');
        const before = player.queue.length;
        
        // Filter out tracks by this user
        const remaining = [];
        const removed = [];
        
        for (const track of player.queue) {
          if (track.requester?.id === target.id) {
            removed.push(track);
          } else {
            remaining.push(track);
          }
        }
        
        if (removed.length === 0) {
          return interaction.reply({ content: `No tracks in queue from ${target}.`, ephemeral: true });
        }
        
        // Clear and re-add remaining tracks
        player.queue.clear();
        for (const track of remaining) {
          player.queue.add(track);
        }
        
        return interaction.reply(`🗑️ Removed **${removed.length}** tracks added by ${target}.`);
      }
    }
  },

  settc: {
    data: new SlashCommandBuilder()
      .setName('settc')
      .setDescription('Set the text channel for bot commands (Admin only)')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Text channel (leave empty to allow all channels)')
          .addChannelTypes(ChannelType.GuildText)
      ),

    async execute(interaction, client) {
      // Check admin permissions
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      
      if (channel) {
        setSetting(interaction.guildId, 'textChannelId', channel.id);
        return interaction.reply(`✅ Bot will only respond to commands in ${channel}.\n\n*Note: Commands in other channels will be ignored.*`);
      } else {
        setSetting(interaction.guildId, 'textChannelId', null);
        return interaction.reply('✅ Bot will respond to commands in any channel.');
      }
    }
  },

  setvc: {
    data: new SlashCommandBuilder()
      .setName('setvc')
      .setDescription('Set the voice channel for the bot (Admin only)')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Voice channel (leave empty to allow all channels)')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
      ),

    async execute(interaction, client) {
      // Check admin permissions
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const channel = interaction.options.getChannel('channel');
      
      if (channel) {
        setSetting(interaction.guildId, 'voiceChannelId', channel.id);
        return interaction.reply(`✅ Bot will only join ${channel}.\n\n*Note: Play commands from other voice channels will be rejected.*`);
      } else {
        setSetting(interaction.guildId, 'voiceChannelId', null);
        return interaction.reply('✅ Bot can join any voice channel.');
      }
    }
  },

  queuetype: {
    data: new SlashCommandBuilder()
      .setName('queuetype')
      .setDescription('Set the queue type (Admin only)')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Queue type')
          .setRequired(true)
          .addChoices(
            { name: 'Linear (default) - Play in order added', value: 'linear' },
            { name: 'Fair - Alternate between users', value: 'fair' }
          )
      ),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const type = interaction.options.getString('type');
      setSetting(interaction.guildId, 'queueType', type);
      
      const description = type === 'fair' 
        ? '🔄 **Fair Queue**: Bot will alternate between users, preventing one person from dominating the queue.'
        : '➡️ **Linear Queue**: Songs play in the order they were added.';
      
      return interaction.reply(`✅ Queue type set to **${type}**\n\n${description}`);
    }
  },

  skipratio: {
    data: new SlashCommandBuilder()
      .setName('skipratio')
      .setDescription('Set the vote skip ratio for this server (Admin only)')
      .addNumberOption(opt =>
        opt.setName('ratio')
          .setDescription('Ratio of listeners needed to skip (0.0-1.0, or leave empty for default)')
          .setMinValue(0.0)
          .setMaxValue(1.0)
      ),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const ratio = interaction.options.getNumber('ratio');
      
      if (ratio !== null) {
        setSetting(interaction.guildId, 'skipRatio', ratio);
        return interaction.reply(`✅ Skip ratio set to **${(ratio * 100).toFixed(0)}%** of listeners needed to skip.`);
      } else {
        setSetting(interaction.guildId, 'skipRatio', null);
        return interaction.reply(`✅ Skip ratio reset to global default (${(client.config.skipRatio * 100).toFixed(0)}%).`);
      }
    }
  },

  autoplaylist: {
    data: new SlashCommandBuilder()
      .setName('autoplaylist')
      .setDescription('Set a playlist to auto-load when bot joins (Owner only)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Playlist name (leave empty to disable)')
          .setAutocomplete(true)
      ),

    async autocomplete(interaction, client) {
      const focused = interaction.options.getFocused().toLowerCase();
      const playlists = listPlaylists(interaction.user.id);
      
      const filtered = playlists
        .filter(p => p.name.toLowerCase().includes(focused))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(p => ({ name: `${p.name} (${p.tracks.length} tracks)`, value: p.name }))
      );
    },

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const name = interaction.options.getString('name');
      
      if (name) {
        const playlist = getPlaylist(interaction.user.id, name);
        if (!playlist) {
          return interaction.reply({ content: `Playlist "${name}" not found.`, ephemeral: true });
        }
        
        setSetting(interaction.guildId, 'autoPlaylist', {
          userId: interaction.user.id,
          name: name
        });
        return interaction.reply(`✅ Auto-playlist set to **${playlist.name}** (${playlist.tracks.length} tracks).\n\nThis playlist will auto-load when the bot joins voice.`);
      } else {
        setSetting(interaction.guildId, 'autoPlaylist', null);
        return interaction.reply('✅ Auto-playlist disabled.');
      }
    }
  },

  songinstatus: {
    data: new SlashCommandBuilder()
      .setName('songinstatus')
      .setDescription('Toggle showing current song in bot status (Owner only)'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const settings = loadSettings(interaction.guildId);
      const newValue = !settings.songInStatus;
      setSetting(interaction.guildId, 'songInStatus', newValue);
      
      // Store this globally for the bot
      client.songInStatus = newValue;
      
      if (!newValue) {
        // Reset to default activity
        client.user.setPresence({
          activities: [{ name: client.config.activityName, type: client.config.activityType }],
          status: client.config.status
        });
      }
      
      const status = newValue ? '✅ Enabled' : '❌ Disabled';
      return interaction.reply(`🎵 Song in status: ${status}\n\n${newValue ? 'Bot status will show the current playing song.' : 'Bot status will show the default activity.'}`);
    }
  },

  serversettings: {
    data: new SlashCommandBuilder()
      .setName('serversettings')
      .setDescription('View all server-specific settings'),

    async execute(interaction, client) {
      const settings = loadSettings(interaction.guildId);
      const guild = interaction.guild;
      
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Server Settings')
        .setColor('#5865F2')
        .addFields(
          { 
            name: '📝 Text Channel', 
            value: settings.textChannelId ? `<#${settings.textChannelId}>` : 'Any channel', 
            inline: true 
          },
          { 
            name: '🔊 Voice Channel', 
            value: settings.voiceChannelId ? `<#${settings.voiceChannelId}>` : 'Any channel', 
            inline: true 
          },
          { 
            name: '📋 Queue Type', 
            value: settings.queueType === 'fair' ? '🔄 Fair (round-robin)' : '➡️ Linear', 
            inline: true 
          },
          { 
            name: '🗳️ Skip Ratio', 
            value: settings.skipRatio !== null ? `${(settings.skipRatio * 100).toFixed(0)}%` : `Default (${(client.config.skipRatio * 100).toFixed(0)}%)`, 
            inline: true 
          },
          { 
            name: '📂 Auto-Playlist', 
            value: settings.autoPlaylist ? `${settings.autoPlaylist.name}` : 'Disabled', 
            inline: true 
          },
          { 
            name: '🎵 Song in Status', 
            value: settings.songInStatus ? '✅ Enabled' : '❌ Disabled', 
            inline: true 
          },
          { 
            name: '🌙 24/7 Mode', 
            value: settings.stayInChannel ? '✅ Enabled' : '❌ Disabled', 
            inline: true 
          }
        )
        .setFooter({ text: 'Use individual commands to change settings' });
      
      return interaction.reply({ embeds: [embed] });
    }
  }
};

module.exports = commands;
