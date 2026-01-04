const { SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const { isOwner, ownerOnlyError } = require('../utils/permissions');

const commands = {
  setavatar: {
    data: new SlashCommandBuilder()
      .setName('setavatar')
      .setDescription('Change the bot\'s avatar (Owner only)')
      .addAttachmentOption(opt =>
        opt.setName('image')
          .setDescription('New avatar image')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('Image URL')
          .setRequired(false)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const attachment = interaction.options.getAttachment('image');
      const url = interaction.options.getString('url');
      
      const imageUrl = attachment?.url || url;
      
      if (!imageUrl) {
        return interaction.reply({ content: 'Please provide an image attachment or URL.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await client.user.setAvatar(imageUrl);
        return interaction.editReply('✅ Avatar updated successfully!');
      } catch (error) {
        return interaction.editReply(`❌ Failed to update avatar: ${error.message}`);
      }
    }
  },

  setname: {
    data: new SlashCommandBuilder()
      .setName('setname')
      .setDescription('Change the bot\'s username (Owner only)')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('New username')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(32)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const name = interaction.options.getString('name');

      await interaction.deferReply({ ephemeral: true });

      try {
        await client.user.setUsername(name);
        return interaction.editReply(`✅ Username changed to **${name}**`);
      } catch (error) {
        return interaction.editReply(`❌ Failed to change username: ${error.message}`);
      }
    }
  },

  setstatus: {
    data: new SlashCommandBuilder()
      .setName('setstatus')
      .setDescription('Change the bot\'s status (Owner only)')
      .addStringOption(opt =>
        opt.setName('status')
          .setDescription('Online status')
          .setRequired(true)
          .addChoices(
            { name: '🟢 Online', value: 'online' },
            { name: '🟡 Idle', value: 'idle' },
            { name: '🔴 Do Not Disturb', value: 'dnd' },
            { name: '⚫ Invisible', value: 'invisible' }
          )
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const status = interaction.options.getString('status');

      client.user.setPresence({ status });
      return interaction.reply({ content: `✅ Status set to **${status}**`, ephemeral: true });
    }
  },

  setgame: {
    data: new SlashCommandBuilder()
      .setName('setgame')
      .setDescription('Change the bot\'s activity (Owner only)')
      .addStringOption(opt =>
        opt.setName('type')
          .setDescription('Activity type')
          .setRequired(true)
          .addChoices(
            { name: '🎮 Playing', value: 'PLAYING' },
            { name: '🎧 Listening', value: 'LISTENING' },
            { name: '📺 Watching', value: 'WATCHING' },
            { name: '🏆 Competing', value: 'COMPETING' },
            { name: '❌ None', value: 'NONE' }
          )
      )
      .addStringOption(opt =>
        opt.setName('text')
          .setDescription('Activity text')
          .setRequired(false)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const type = interaction.options.getString('type');
      const text = interaction.options.getString('text') || 'music | /help';

      if (type === 'NONE') {
        client.user.setPresence({ activities: [] });
        return interaction.reply({ content: '✅ Activity cleared', ephemeral: true });
      }

      const activityTypes = {
        'PLAYING': ActivityType.Playing,
        'LISTENING': ActivityType.Listening,
        'WATCHING': ActivityType.Watching,
        'COMPETING': ActivityType.Competing
      };

      client.user.setPresence({
        activities: [{ name: text, type: activityTypes[type] }]
      });

      return interaction.reply({ content: `✅ Activity set to **${type}** ${text}`, ephemeral: true });
    }
  },

  shutdown: {
    data: new SlashCommandBuilder()
      .setName('shutdown')
      .setDescription('Shutdown the bot (Owner only)'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      await interaction.reply({ content: '👋 Shutting down...', ephemeral: true });
      
      // Destroy all players
      for (const [guildId, player] of client.kazagumo.players) {
        player.destroy();
      }

      // Disconnect from Discord
      client.destroy();
      process.exit(0);
    }
  },

  debug: {
    data: new SlashCommandBuilder()
      .setName('debug')
      .setDescription('Show debug information (Owner only)'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const node = client.kazagumo.shoukaku.nodes.get('Main');
      
      const embed = new EmbedBuilder()
        .setTitle('🔧 Debug Information')
        .setColor('#FF6B6B')
        .addFields(
          { name: 'Bot', value: [
            `User: ${client.user.tag}`,
            `ID: ${client.user.id}`,
            `Guilds: ${client.guilds.cache.size}`,
            `Uptime: ${Math.floor(process.uptime())}s`
          ].join('\n'), inline: true },
          { name: 'Config', value: [
            `Owner: ${client.config.ownerId || 'Not set'}`,
            `DJ Role: ${client.config.djRoleId || 'Not set'}`,
            `Default Volume: ${client.config.defaultVolume}%`,
            `Max Queue: ${client.config.maxQueueSize || 'Unlimited'}`,
            `Max Duration: ${client.config.maxDuration || 'Unlimited'}s`,
            `Skip Ratio: ${client.config.skipRatio * 100}%`
          ].join('\n'), inline: true },
          { name: 'Lavalink', value: [
            `Node: ${node?.name || 'Not connected'}`,
            `State: ${node?.state || 'Unknown'}`,
            `Players: ${client.kazagumo.players.size}`,
            `Ping: ${node?.stats?.ping || 'N/A'}ms`
          ].join('\n'), inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

module.exports = commands;
