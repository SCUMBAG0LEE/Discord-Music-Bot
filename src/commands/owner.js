const { SlashCommandBuilder, EmbedBuilder, ActivityType } = require('discord.js');
const { isOwner, ownerOnlyError } = require('../utils/permissions');
const { logger } = require('../utils/logger');

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
        logger.error('SetAvatar', 'Failed to update avatar', error);
        return interaction.editReply(`❌ Failed to update avatar: ${error.message}`);
      }
    }
  },

  setbanner: {
    data: new SlashCommandBuilder()
      .setName('setbanner')
      .setDescription('Change the bot\'s banner (Owner only)')
      .addAttachmentOption(opt =>
        opt.setName('image')
          .setDescription('New banner image')
          .setRequired(false)
      )
      .addStringOption(opt =>
        opt.setName('url')
          .setDescription('Image URL')
          .setRequired(false)
      )
      .addBooleanOption(opt =>
        opt.setName('remove')
          .setDescription('Remove the current banner')
          .setRequired(false)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const attachment = interaction.options.getAttachment('image');
      const url = interaction.options.getString('url');
      const remove = interaction.options.getBoolean('remove');

      if (remove) {
        await interaction.deferReply({ ephemeral: true });
        try {
          await client.user.setBanner(null);
          return interaction.editReply('✅ Banner removed!');
        } catch (error) {
          logger.error('SetBanner', 'Failed to remove banner', error);
          return interaction.editReply(`❌ Failed to remove banner: ${error.message}`);
        }
      }

      const imageUrl = attachment?.url || url;

      if (!imageUrl) {
        return interaction.reply({ content: 'Please provide an image attachment, URL, or use `remove: true`.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        await client.user.setBanner(imageUrl);
        return interaction.editReply('✅ Banner updated successfully!');
      } catch (error) {
        logger.error('SetBanner', 'Failed to update banner', error);
        return interaction.editReply(`❌ Failed to update banner: ${error.message}`);
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
        logger.error('SetName', 'Failed to change username', error);
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

      // Persist so future presence updates keep this status
      client.config.status = status;

      // Rebuild presence with current activity but new status
      client.user.setPresence(client.buildPresence(
        client.user.presence.activities?.[0]?.name || client.config.activityName,
        { status }
      ));
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
            { name: '🟣 Streaming', value: 'STREAMING' },
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
        // Reset config to defaults so future updates use defaults
        client.config.activityType = ActivityType.Listening;
        client.config.activityName = 'music | /help';
        return interaction.reply({ content: '✅ Activity cleared', ephemeral: true });
      }

      const activityTypes = {
        'PLAYING': ActivityType.Playing,
        'LISTENING': ActivityType.Listening,
        'WATCHING': ActivityType.Watching,
        'COMPETING': ActivityType.Competing,
        'STREAMING': ActivityType.Streaming
      };

      // Persist into config so future presence updates keep this activity
      client.config.activityType = activityTypes[type];
      client.config.activityName = text;

      const activity = { name: text, type: activityTypes[type] };
      // Streaming needs a URL for the purple badge
      if (type === 'STREAMING' && client.config?.streamingUrl) {
        activity.url = client.config.streamingUrl;
      }

      client.user.setPresence({
        activities: [activity],
        status: client.config.status
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
      
      // Snapshot queue IDs first — queue.stop() modifies the collection
      const guildIds = [...client.distube.queues.keys()];
      for (const guildId of guildIds) {
        try {
          const queue = client.distube.getQueue(guildId);
          if (queue) {
            queue._stopped = true;
            await queue.stop();
          }
        } catch (e) {
          // Ignore errors during shutdown
        }
        // Force disconnect voice (queue.stop doesn't leave in v5)
        try {
          const { getVoiceConnection } = require('@discordjs/voice');
          const conn = getVoiceConnection(guildId);
          if (conn) conn.destroy();
        } catch {}
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

      const used = process.memoryUsage();
      const uptimeSeconds = Math.floor(process.uptime());
      const uptimeStr = formatUptime(uptimeSeconds);
      
      // Count active queues
      const activeQueues = client.distube.queues.size;
      
      const embed = new EmbedBuilder()
        .setTitle('🔧 Debug Information')
        .setColor('#FF6B6B')
        .addFields(
          { name: 'Bot', value: [
            `User: ${client.user.tag}`,
            `ID: ${client.user.id}`,
            `Guilds: ${client.guilds.cache.size}`,
            `Uptime: ${uptimeStr}`
          ].join('\n'), inline: true },
          { name: 'Config', value: [
            `Owner: ${client.config?.ownerId || 'Not set'}`,
            `DJ Role: ${client.config?.djRoleId || 'Not set'}`,
            `Default Volume: ${client.config?.defaultVolume || 50}%`,
            `Skip Ratio: ${((client.config?.skipRatio || 0.5) * 100).toFixed(0)}%`
          ].join('\n'), inline: true },
          { name: 'Memory', value: [
            `Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            `Heap Total: ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            `RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`
          ].join('\n'), inline: true },
          { name: 'Music', value: [
            `Active Queues: ${activeQueues}`,
            `DisTube Version: ${require('distube').version || 'Unknown'}`,
            `discord.js Version: ${require('discord.js').version}`
          ].join('\n'), inline: true }
        )
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  eval: {
    data: new SlashCommandBuilder()
      .setName('eval')
      .setDescription('Evaluate JavaScript code (Owner only)')
      .addStringOption(opt =>
        opt.setName('code')
          .setDescription('Code to evaluate')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const code = interaction.options.getString('code');
      
      try {
        // eslint-disable-next-line no-eval
        let result = eval(code);
        
        if (result instanceof Promise) {
          result = await result;
        }
        
        let output = typeof result === 'string' ? result : require('util').inspect(result, { depth: 1 });
        
        // Truncate if too long
        if (output.length > 1900) {
          output = output.substring(0, 1900) + '...';
        }
        
        // Hide token if accidentally exposed
        if (process.env.BOT_TOKEN) {
          output = output.replace(new RegExp(process.env.BOT_TOKEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[TOKEN]');
        }
        
        return interaction.reply({ content: `\`\`\`js\n${output}\n\`\`\``, ephemeral: true });
      } catch (error) {
        return interaction.reply({ content: `❌ Error:\n\`\`\`\n${error.message}\n\`\`\``, ephemeral: true });
      }
    }
  },

  servers: {
    data: new SlashCommandBuilder()
      .setName('servers')
      .setDescription('List all servers the bot is in (Owner only)'),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const guilds = [...client.guilds.cache.values()]
        .sort((a, b) => b.memberCount - a.memberCount)
        .slice(0, 25)
        .map((g, i) => `${i + 1}. **${g.name}** (${g.memberCount} members)`);

      const embed = new EmbedBuilder()
        .setTitle(`📊 Servers (${client.guilds.cache.size} total)`)
        .setDescription(guilds.join('\n') || 'No servers')
        .setColor('#5865F2')
        .setTimestamp();

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }
  },

  leaveserver: {
    data: new SlashCommandBuilder()
      .setName('leaveserver')
      .setDescription('Make the bot leave a server (Owner only)')
      .addStringOption(opt =>
        opt.setName('serverid')
          .setDescription('Server ID to leave')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isOwner(interaction.user.id, client)) {
        return ownerOnlyError(interaction);
      }

      const serverId = interaction.options.getString('serverid');
      const guild = client.guilds.cache.get(serverId);

      if (!guild) {
        return interaction.reply({ content: `❌ Server with ID \`${serverId}\` not found.`, ephemeral: true });
      }

      const guildName = guild.name;
      
      try {
        await guild.leave();
        return interaction.reply({ content: `✅ Left server **${guildName}**`, ephemeral: true });
      } catch (error) {
        logger.error('LeaveServer', `Failed to leave ${guildName}`, error);
        return interaction.reply({ content: `❌ Failed to leave server: ${error.message}`, ephemeral: true });
      }
    }
  }
};

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

module.exports = commands;
