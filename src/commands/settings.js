const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isDJ, djOnlyError, getBotVoicePermissionIssue, isGuildInteraction } = require('../utils/permissions');
const { loadSettings, setSetting, getEffectiveSkipRatio, canUseVoiceChannel } = require('../services/serverSettings');

const commands = {
  settings: {
    data: new SlashCommandBuilder()
      .setName('settings')
      .setDescription('View or change music settings')
      .addSubcommand(sub =>
        sub.setName('view')
          .setDescription('View current settings')
      )
      .addSubcommand(sub =>
        sub.setName('volume')
          .setDescription('Set default volume for this server')
          .addIntegerOption(opt =>
            opt.setName('level')
              .setDescription('Volume level (0-200)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(200)
          )
      )
      .addSubcommand(sub =>
        sub.setName('announcements')
          .setDescription('Toggle now playing announcements')
          .addBooleanOption(opt =>
            opt.setName('enabled')
              .setDescription('Enable announcements')
              .setRequired(true)
          )
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const sub = interaction.options.getSubcommand();
      const settings = loadSettings(interaction.guildId);
      const defaults = client.config || {};

      if (sub === 'view') {
        const embed = new EmbedBuilder()
          .setTitle('🎵 Music Settings')
          .setColor('#5865F2')
          .addFields(
            { 
              name: '🔊 Default Volume', 
              value: `${settings.defaultVolume || defaults.defaultVolume || 50}%`,
              inline: true 
            },
            { 
              name: '📢 Announcements', 
              value: settings.announceNowPlaying !== false ? 'Enabled' : 'Disabled',
              inline: true 
            },
            { 
              name: '🔁 Loop Mode', 
              value: settings.defaultLoopMode || 'off',
              inline: true 
            },
            { 
              name: '📻 24/7 Mode', 
              value: settings.stayInChannel ? 'Enabled' : 'Disabled',
              inline: true 
            },
            { 
              name: '🔀 Autoplay', 
              value: settings.autoplay ? 'Enabled' : 'Disabled',
              inline: true 
            }
          )
          .setFooter({ text: 'Use /settings <option> to change settings' });

        return interaction.reply({ embeds: [embed] });
      }

      // DJ check for changing settings
      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }

      if (sub === 'volume') {
        const level = interaction.options.getInteger('level');
        setSetting(interaction.guildId, 'defaultVolume', level);
        
        // Apply to current queue if exists
        const queue = client.distube.getQueue(interaction.guildId);
        if (queue) {
          queue.setVolume(level);
        }
        
        return interaction.reply(`🔊 Default volume set to **${level}%**`);
      }

      if (sub === 'announcements') {
        const enabled = interaction.options.getBoolean('enabled');
        setSetting(interaction.guildId, 'announceNowPlaying', enabled);
        
        return interaction.reply(enabled 
          ? '📢 Now playing announcements **enabled**'
          : '🔇 Now playing announcements **disabled**');
      }
    }
  },

  forceskip: {
    data: new SlashCommandBuilder()
      .setName('forceskip')
      .setDescription('Force skip the current song (DJ only)'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs[0]) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }

      const current = queue.songs[0];
      
      try {
        await queue.skip();
        return interaction.reply(`⏭️ Force skipped **${current.name}**`);
      } catch (error) {
        // If skip fails (no more songs), stop and disconnect
        queue._stopped = true;
        client.clearGuildTimeout?.(interaction.guildId);
        await queue.stop();
        client.clearGuildTimeout?.(interaction.guildId);
        try {
          if (client.distube?.voices?.get(interaction.guildId)) {
            client.distube.voices.leave(interaction.guildId);
          } else {
            const { getVoiceConnection } = require('@discordjs/voice');
            const conn = getVoiceConnection(interaction.guildId);
            if (conn) conn.destroy();
          }
        } catch {}
        return interaction.reply(`⏹️ Skipped **${current.name}** - queue is now empty`);
      }
    }
  },

  voteskip: {
    data: new SlashCommandBuilder()
      .setName('voteskip')
      .setDescription('Vote to skip the current song'),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs[0]) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }

      // Check if user is in voice channel
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel || voiceChannel.id !== queue.voiceChannel?.id) {
        return interaction.reply({ content: 'You must be in the same voice channel.', ephemeral: true });
      }

      // Initialize skip votes if not exists
      if (!queue.skipVotes) {
        queue.skipVotes = new Set();
      }

      // Check if already voted
      if (queue.skipVotes.has(interaction.user.id)) {
        return interaction.reply({ content: 'You already voted to skip!', ephemeral: true });
      }

      queue.skipVotes.add(interaction.user.id);

      // Count listeners (exclude bot)
      const listeners = voiceChannel.members.filter(m => !m.user.bot).size;
      const skipRatio = getEffectiveSkipRatio(interaction.guildId, client.config?.skipRatio || 0.5);
      const votesNeeded = Math.max(1, Math.ceil(listeners * skipRatio));
      const currentVotes = queue.skipVotes.size;

      if (currentVotes >= votesNeeded) {
        queue.skipVotes.clear();
        const current = queue.songs[0];
        
        try {
          await queue.skip();
          return interaction.reply(`⏭️ Vote passed! Skipped **${current.name}**`);
        } catch (error) {
          queue._stopped = true;
          client.clearGuildTimeout?.(interaction.guildId);
          await queue.stop();
          client.clearGuildTimeout?.(interaction.guildId);
          try {
            if (client.distube?.voices?.get(interaction.guildId)) {
              client.distube.voices.leave(interaction.guildId);
            } else {
              const { getVoiceConnection } = require('@discordjs/voice');
              const conn = getVoiceConnection(interaction.guildId);
              if (conn) conn.destroy();
            }
          } catch {}
          return interaction.reply(`⏹️ Vote passed! Skipped **${current.name}** - queue is now empty`);
        }
      }

      return interaction.reply(`🗳️ Skip vote: **${currentVotes}/${votesNeeded}** (${listeners} listeners)`);
    }
  },

  forceplay: {
    data: new SlashCommandBuilder()
      .setName('forceplay')
      .setDescription('Play a song immediately, skipping the current one (DJ only)')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('Song URL or search term')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }

      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must be in a voice channel.', ephemeral: true });
      }

      // Check voice channel lock
      if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
        const settings = loadSettings(interaction.guildId);
        return interaction.reply({ 
          content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
          ephemeral: true 
        });
      }

      const voicePermissionIssue = getBotVoicePermissionIssue(interaction.guild, voiceChannel);
      if (voicePermissionIssue) {
        return interaction.reply({ content: '❌ ' + voicePermissionIssue, ephemeral: true });
      }

      await interaction.deferReply();

      const query = interaction.options.getString('query');

      try {
        // Check if query is a URL
        const isUrl = /^https?:\/\//.test(query);
        let playUrl = query;
        
        // For search terms, use yt-dlp to search YouTube
        if (!isUrl) {
          const ytdlpPlugin = client.distube.ytdlpPlugin;
          if (ytdlpPlugin) {
            const results = await ytdlpPlugin.search(query, 1);
            if (results && results.length > 0) {
              playUrl = results[0].url;
            }
          }
        }
        
        // Use DisTube's play with skip option
        await client.distube.play(voiceChannel, playUrl, {
          textChannel: interaction.channel,
          member: interaction.member,
          skip: true // This tells DisTube to play immediately
        });
        
        return interaction.editReply(`⏩ Force playing: **${query.substring(0, 100)}**`);
      } catch (error) {
        const isVoiceConnectFailure =
          error?.code === 'VOICE_CONNECT_FAILED'
          || /Cannot connect to the voice channel after 30 seconds/i.test(error?.message || '');
        if (isVoiceConnectFailure) {
          const guidance = getBotVoicePermissionIssue(interaction.guild, voiceChannel)
            || 'Voice connect timed out. If permissions are correct, this is usually a host/network issue (blocked UDP/firewall/NAT).';
          return interaction.editReply('❌ ' + guidance);
        }
        return interaction.editReply(`❌ Error: ${error.message.slice(0, 200)}`);
      }
    }
  },

  playnext: {
    data: new SlashCommandBuilder()
      .setName('playnext')
      .setDescription('Add a song to play next in queue')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('Song URL or search term')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must be in a voice channel.', ephemeral: true });
      }

      // Check voice channel lock
      if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
        const settings = loadSettings(interaction.guildId);
        return interaction.reply({ 
          content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
          ephemeral: true 
        });
      }

      const voicePermissionIssue = getBotVoicePermissionIssue(interaction.guild, voiceChannel);
      if (voicePermissionIssue) {
        return interaction.reply({ content: '❌ ' + voicePermissionIssue, ephemeral: true });
      }

      await interaction.deferReply();

      const query = interaction.options.getString('query');

      try {
        // Check if query is a URL
        const isUrl = /^https?:\/\//.test(query);
        let playUrl = query;
        
        // For search terms, use yt-dlp to search YouTube
        if (!isUrl) {
          const ytdlpPlugin = client.distube.ytdlpPlugin;
          if (ytdlpPlugin) {
            const results = await ytdlpPlugin.search(query, 1);
            if (results && results.length > 0) {
              playUrl = results[0].url;
            }
          }
        }
        
        // Use DisTube's play with position 1 (next after current)
        await client.distube.play(voiceChannel, playUrl, {
          textChannel: interaction.channel,
          member: interaction.member,
          position: 1
        });
        
        return interaction.editReply(`⏭️ Added to play next: **${query.substring(0, 100)}**`);
      } catch (error) {
        const isVoiceConnectFailure =
          error?.code === 'VOICE_CONNECT_FAILED'
          || /Cannot connect to the voice channel after 30 seconds/i.test(error?.message || '');
        if (isVoiceConnectFailure) {
          const guidance = getBotVoicePermissionIssue(interaction.guild, voiceChannel)
            || 'Voice connect timed out. If permissions are correct, this is usually a host/network issue (blocked UDP/firewall/NAT).';
          return interaction.editReply('❌ ' + guidance);
        }
        return interaction.editReply(`❌ Error: ${error.message.slice(0, 200)}`);
      }
    }
  },

  '247': {
    data: new SlashCommandBuilder()
      .setName('247')
      .setDescription('Toggle 24/7 mode - bot stays in voice channel (DJ only)')
      .addBooleanOption(opt =>
        opt.setName('enabled')
          .setDescription('Enable 24/7 mode')
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }

      const settings = loadSettings(interaction.guildId);
      const enabledOption = interaction.options.getBoolean('enabled');
      
      // Toggle if not specified
      const newValue = enabledOption !== null ? enabledOption : !settings.stayInChannel;
      
      setSetting(interaction.guildId, 'stayInChannel', newValue);

      // Apply to current queue if active
      const queue = client.distube.getQueue(interaction.guildId);
      if (queue) {
        queue.stayInChannel = newValue;
      }

      // If disabling, and bot is idle in VC with no queue, start idle timeout
      if (!newValue && !queue) {
        const guild = interaction.guild;
        if (guild?.members?.me?.voice?.channel) {
          client.startIdleTimeout?.(interaction.guildId, {
            textChannel: interaction.channel
          });
        }
      }

      if (newValue) {
        return interaction.reply('📻 **24/7 Mode enabled** - Bot will stay in voice channel even when idle');
      } else {
        return interaction.reply('📴 **24/7 Mode disabled** - Bot will leave voice channel when idle');
      }
    }
  },

  autoplay: {
    data: new SlashCommandBuilder()
      .setName('autoplay')
      .setDescription('Toggle autoplay - automatically queue related songs')
      .addBooleanOption(opt =>
        opt.setName('enabled')
          .setDescription('Enable autoplay')
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }

      const enabledOption = interaction.options.getBoolean('enabled');
      
      // Determine the desired state
      const newValue = enabledOption !== null ? enabledOption : !queue.autoplay;
      
      // Only toggle if current state differs from desired
      if (queue.autoplay !== newValue) {
        queue.toggleAutoplay();
      }
      
      const isEnabled = queue.autoplay;

      if (isEnabled) {
        return interaction.reply('🔄 **Autoplay enabled** - Related songs will be added automatically');
      } else {
        return interaction.reply('⏹️ **Autoplay disabled**');
      }
    }
  },

  loop: {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Set loop mode')
      .addStringOption(opt =>
        opt.setName('mode')
          .setDescription('Loop mode')
          .setRequired(true)
          .addChoices(
            { name: '❌ Off', value: 'off' },
            { name: '🔂 Song - Repeat current song', value: 'song' },
            { name: '🔁 Queue - Repeat entire queue', value: 'queue' }
          )
      ),

    async execute(interaction, client) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }

      const mode = interaction.options.getString('mode');
      
      // DisTube loop modes: 0 = off, 1 = song, 2 = queue
      const modeMap = { 'off': 0, 'song': 1, 'queue': 2 };
      const modeEmoji = { 'off': '❌', 'song': '🔂', 'queue': '🔁' };
      
      queue.setRepeatMode(modeMap[mode]);

      return interaction.reply(`${modeEmoji[mode]} Loop mode set to **${mode}**`);
    }
  }
};

module.exports = commands;
