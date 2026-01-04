const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { isOwner, isDJ, djOnlyError, ownerOnlyError } = require('../utils/permissions');

const commands = {
  settings: {
    data: new SlashCommandBuilder()
      .setName('settings')
      .setDescription('View or change bot settings')
      .addSubcommand(sub =>
        sub.setName('view')
          .setDescription('View current settings')
      )
      .addSubcommand(sub =>
        sub.setName('volume')
          .setDescription('Set default volume for new players')
          .addIntegerOption(opt =>
            opt.setName('level')
              .setDescription('Volume level (0-150)')
              .setRequired(true)
              .setMinValue(0)
              .setMaxValue(150)
          )
      )
      .addSubcommand(sub =>
        sub.setName('djrole')
          .setDescription('Set the DJ role (owner only)')
          .addRoleOption(opt =>
            opt.setName('role')
              .setDescription('Role to set as DJ (leave empty to clear)')
          )
      )
      .addSubcommand(sub =>
        sub.setName('247')
          .setDescription('Toggle 24/7 mode for this server')
      ),

    async execute(interaction, client) {
      const sub = interaction.options.getSubcommand();
      const player = client.kazagumo.players.get(interaction.guildId);

      switch (sub) {
        case 'view': {
          const embed = new EmbedBuilder()
            .setTitle('⚙️ Bot Settings')
            .setColor('#5865F2')
            .addFields(
              { name: 'Default Volume', value: `${client.config.defaultVolume}%`, inline: true },
              { name: 'DJ Role', value: client.config.djRoleId ? `<@&${client.config.djRoleId}>` : 'Not set', inline: true },
              { name: 'Idle Timeout', value: `${client.config.idleTimeUntilStop}s`, inline: true },
              { name: 'Alone Timeout', value: `${client.config.aloneTimeUntilStop}s`, inline: true },
              { name: 'Global 24/7', value: client.config.stayInChannel ? '✅ Enabled' : '❌ Disabled', inline: true },
              { name: 'Server 24/7', value: player?.data?.stayInChannel ? '✅ Enabled' : '❌ Disabled', inline: true }
            );
          return interaction.reply({ embeds: [embed] });
        }

        case 'volume': {
          if (!isDJ(interaction.member, client)) {
            return djOnlyError(interaction);
          }
          const level = interaction.options.getInteger('level');
          client.config.defaultVolume = level;
          return interaction.reply(`🔊 Default volume set to **${level}%**`);
        }

        case 'djrole': {
          if (!isOwner(interaction.user.id, client)) {
            return ownerOnlyError(interaction);
          }
          const role = interaction.options.getRole('role');
          if (role) {
            client.config.djRoleId = role.id;
            return interaction.reply(`✅ DJ role set to ${role}`);
          } else {
            client.config.djRoleId = '';
            return interaction.reply('✅ DJ role cleared - everyone can use DJ commands.');
          }
        }

        case '247': {
          if (!isDJ(interaction.member, client)) {
            return djOnlyError(interaction);
          }
          
          if (!player) {
            return interaction.reply({ content: 'Not connected to voice.', ephemeral: true });
          }
          
          player.data.stayInChannel = !player.data.stayInChannel;
          const status = player.data.stayInChannel ? '✅ Enabled' : '❌ Disabled';
          return interaction.reply(`🌙 24/7 mode: ${status}\nBot will ${player.data.stayInChannel ? 'stay' : 'leave when idle'}.`);
        }
      }
    }
  },

  forceskip: {
    data: new SlashCommandBuilder()
      .setName('forceskip')
      .setDescription('Force skip the current track (DJ only)'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }
      
      const title = player.queue.current.title;
      player.skip();
      return interaction.reply(`⏭️ Force skipped **${title}**`);
    }
  },

  voteskip: {
    data: new SlashCommandBuilder()
      .setName('voteskip')
      .setDescription('Vote to skip the current track'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      const member = interaction.member;
      
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      if (!member.voice.channel || member.voice.channelId !== player.voiceId) {
        return interaction.reply({ content: 'You must be in the voice channel.', ephemeral: true });
      }
      
      // Initialize votes if needed
      if (!player.data.skipVotes) {
        player.data.skipVotes = new Set();
      }
      
      // Check if already voted
      if (player.data.skipVotes.has(member.user.id)) {
        return interaction.reply({ content: 'You already voted to skip.', ephemeral: true });
      }
      
      // Add vote
      player.data.skipVotes.add(member.user.id);
      
      // Calculate votes needed (50% of listeners, min 1)
      const voiceChannel = member.voice.channel;
      const listeners = voiceChannel.members.filter(m => !m.user.bot).size;
      const votesNeeded = Math.ceil(listeners / 2);
      const currentVotes = player.data.skipVotes.size;
      
      // Check if enough votes
      if (currentVotes >= votesNeeded) {
        const title = player.queue.current.title;
        player.data.skipVotes.clear();
        player.skip();
        return interaction.reply(`⏭️ Vote passed! Skipped **${title}**`);
      }
      
      return interaction.reply(`🗳️ Skip vote: **${currentVotes}/${votesNeeded}** votes`);
    }
  },

  forceplay: {
    data: new SlashCommandBuilder()
      .setName('forceplay')
      .setDescription('Play a song immediately, skipping the current track (DJ only)')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('Song URL or search query')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      if (!isDJ(interaction.member, client)) {
        return djOnlyError(interaction);
      }
      
      const query = interaction.options.getString('query');
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({ content: '❌ You need to be in a voice channel.', ephemeral: true });
      }

      await interaction.deferReply();

      try {
        const result = await client.kazagumo.search(query, { requester: interaction.user });

        if (!result || !result.tracks.length) {
          return interaction.editReply('❌ No results found.');
        }

        let player = client.kazagumo.players.get(interaction.guildId);
        
        if (!player) {
          player = await client.kazagumo.createPlayer({
            guildId: interaction.guildId,
            textId: interaction.channelId,
            voiceId: voiceChannel.id,
            volume: client.config.defaultVolume,
            deaf: true
          });
        }

        const track = result.tracks[0];
        
        // Add to front of queue
        player.queue.unshift(track);
        
        // Skip current if playing
        if (player.playing) {
          player.skip();
          return interaction.editReply(`⏭️ Force playing **${track.title}**`);
        } else {
          player.play();
          return interaction.editReply(`🎵 Playing **${track.title}**`);
        }
      } catch (error) {
        console.error('Forceplay error:', error);
        return interaction.editReply('❌ An error occurred.');
      }
    }
  },

  playnext: {
    data: new SlashCommandBuilder()
      .setName('playnext')
      .setDescription('Add a song to play next in the queue')
      .addStringOption(opt =>
        opt.setName('query')
          .setDescription('Song URL or search query')
          .setRequired(true)
      ),

    async execute(interaction, client) {
      const query = interaction.options.getString('query');
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({ content: '❌ You need to be in a voice channel.', ephemeral: true });
      }

      await interaction.deferReply();

      try {
        const result = await client.kazagumo.search(query, { requester: interaction.user });

        if (!result || !result.tracks.length) {
          return interaction.editReply('❌ No results found.');
        }

        let player = client.kazagumo.players.get(interaction.guildId);
        
        if (!player) {
          player = await client.kazagumo.createPlayer({
            guildId: interaction.guildId,
            textId: interaction.channelId,
            voiceId: voiceChannel.id,
            volume: client.config.defaultVolume,
            deaf: true
          });
        }

        const track = result.tracks[0];
        
        // Add to front of queue (position 0)
        player.queue.splice(0, 0, track);

        if (!player.playing && !player.paused) {
          player.play();
          return interaction.editReply(`🎵 Playing **${track.title}**`);
        }

        return interaction.editReply(`📥 **${track.title}** will play next`);
      } catch (error) {
        console.error('Playnext error:', error);
        return interaction.editReply('❌ An error occurred.');
      }
    }
  }
};

module.exports = commands;
