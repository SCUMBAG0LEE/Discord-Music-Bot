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

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || queue.songs.length <= 1) {
        return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === 'position') {
        const pos = interaction.options.getInteger('pos');
        const index = pos - 1; // Position 1 is current, position 2 is index 1
        
        if (index >= queue.songs.length) {
          return interaction.reply({ content: `Invalid position. Queue has ${queue.songs.length} tracks.`, ephemeral: true });
        }
        
        const removed = queue.songs.splice(index, 1)[0];
        return interaction.reply(`🗑️ Force removed **${removed.name}** (requested by ${removed.member?.displayName || 'Unknown'})`);
      }

      if (sub === 'user') {
        const target = interaction.options.getUser('target');
        const before = queue.songs.length;
        
        // Find all tracks by this user (skip current song at index 0)
        const toRemove = [];
        for (let i = queue.songs.length - 1; i >= 1; i--) {
          if (queue.songs[i].member?.id === target.id) {
            toRemove.push(queue.songs.splice(i, 1)[0]);
          }
        }
        
        if (toRemove.length === 0) {
          return interaction.reply({ content: `No tracks in queue from ${target}.`, ephemeral: true });
        }
        
        return interaction.reply(`🗑️ Removed **${toRemove.length}** tracks added by ${target}.`);
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
        const defaultRatio = client.config?.skipRatio || 0.5;
        return interaction.reply(`✅ Skip ratio reset to global default (${(defaultRatio * 100).toFixed(0)}%).`);
      }
    }
  },

  autoplaylist: {
    data: new SlashCommandBuilder()
      .setName('autoplaylist')
      .setDescription('Set an auto-playlist when nothing is playing (Admin only)')
      .addStringOption(opt =>
        opt.setName('playlist')
          .setDescription('Playlist name (leave empty to disable)')
          .setAutocomplete(true)
      ),

    async autocomplete(interaction) {
      const focusedValue = interaction.options.getFocused().toLowerCase();
      const { playlists } = await listPlaylists(interaction.user.id);
      
      const filtered = (playlists || [])
        .filter(p => p.name.toLowerCase().includes(focusedValue))
        .slice(0, 25)
        .map(p => ({ name: `${p.name} (${p.songCount} tracks)`, value: p.name }));
      
      await interaction.respond(filtered);
    },

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const playlistName = interaction.options.getString('playlist');
      
      if (playlistName) {
        // Verify playlist exists (check user's playlists)
        const playlist = getPlaylist(interaction.user.id, playlistName);
        if (!playlist) {
          return interaction.reply({ content: `Playlist **${playlistName}** not found.`, ephemeral: true });
        }
        
        // Store both playlist name and user ID for auto-playlist
        setSetting(interaction.guildId, 'autoPlaylist', { name: playlistName, userId: interaction.user.id });
        return interaction.reply(`✅ Auto-playlist set to **${playlistName}** (${playlist.songs?.length || 0} tracks).\n\nWhen the queue ends, this playlist will automatically start.`);
      } else {
        setSetting(interaction.guildId, 'autoPlaylist', null);
        return interaction.reply('✅ Auto-playlist disabled.');
      }
    }
  },

  songinstatus: {
    data: new SlashCommandBuilder()
      .setName('songinstatus')
      .setDescription('Toggle showing current song in bot status (Admin only)')
      .addBooleanOption(opt =>
        opt.setName('enabled')
          .setDescription('Enable song in status')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const enabled = interaction.options.getBoolean('enabled');
      setSetting(interaction.guildId, 'songInStatus', enabled);
      
      if (enabled) {
        return interaction.reply('✅ Bot status will now show the current song.');
      } else {
        return interaction.reply('✅ Bot status will no longer show the current song.');
      }
    }
  },

  serversettings: {
    data: new SlashCommandBuilder()
      .setName('serversettings')
      .setDescription('View all server settings (Admin only)'),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const settings = loadSettings(interaction.guildId);
      const defaults = client.config || {};
      
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
            value: settings.queueType || 'linear',
            inline: true 
          },
          { 
            name: '⏭️ Skip Ratio', 
            value: settings.skipRatio !== undefined 
              ? `${(settings.skipRatio * 100).toFixed(0)}%` 
              : `${((defaults.skipRatio || 0.5) * 100).toFixed(0)}% (default)`,
            inline: true 
          },
          { 
            name: '🎵 Auto-Playlist', 
            value: settings.autoPlaylist?.name || 'Disabled',
            inline: true 
          },
          { 
            name: '📊 Song in Status', 
            value: settings.songInStatus ? 'Enabled' : 'Disabled',
            inline: true 
          },
          { 
            name: '🔊 Default Volume', 
            value: `${settings.defaultVolume || defaults.defaultVolume || 50}%`,
            inline: true 
          },
          { 
            name: '🎭 DJ Role', 
            value: settings.djRoleId ? `<@&${settings.djRoleId}>` : (defaults.djRoleId ? `<@&${defaults.djRoleId}>` : 'Not set'),
            inline: true 
          },
          { 
            name: '📻 24/7 Mode', 
            value: settings.stayInChannel ? 'Enabled' : 'Disabled',
            inline: true 
          }
        )
        .setFooter({ text: 'Use /settc, /setvc, /queuetype, /skipratio to change settings' });

      return interaction.reply({ embeds: [embed] });
    }
  },

  maxduration: {
    data: new SlashCommandBuilder()
      .setName('maxduration')
      .setDescription('Set maximum song duration in seconds (Admin only)')
      .addIntegerOption(opt =>
        opt.setName('seconds')
          .setDescription('Max duration in seconds (0 = unlimited)')
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(86400)
      ),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const seconds = interaction.options.getInteger('seconds');
      
      if (seconds === 0) {
        setSetting(interaction.guildId, 'maxDuration', null);
        return interaction.reply('✅ Maximum song duration removed (unlimited).');
      }
      
      setSetting(interaction.guildId, 'maxDuration', seconds);
      
      const hours = Math.floor(seconds / 3600);
      const mins = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      const timeStr = hours > 0 
        ? `${hours}h ${mins}m ${secs}s`
        : mins > 0 
          ? `${mins}m ${secs}s`
          : `${secs}s`;
      
      return interaction.reply(`✅ Maximum song duration set to **${timeStr}**.\n\nSongs longer than this will be rejected.`);
    }
  },

  setdjrole: {
    data: new SlashCommandBuilder()
      .setName('setdjrole')
      .setDescription('Set the DJ role for this server (Admin only)')
      .addRoleOption(opt =>
        opt.setName('role')
          .setDescription('DJ role (leave empty to clear)')
      ),

    async execute(interaction, client) {
      if (!interaction.member.permissions.has('Administrator') && !isOwner(interaction.user.id, client)) {
        return interaction.reply({ content: '🔒 This command requires Administrator permission.', ephemeral: true });
      }

      const role = interaction.options.getRole('role');
      
      if (role) {
        setSetting(interaction.guildId, 'djRoleId', role.id);
        return interaction.reply(`✅ DJ role set to ${role}.\n\nMembers with this role can use DJ-only commands.`);
      } else {
        setSetting(interaction.guildId, 'djRoleId', null);
        return interaction.reply('✅ DJ role cleared. Only administrators can use DJ commands now.');
      }
    }
  }
};

module.exports = commands;
