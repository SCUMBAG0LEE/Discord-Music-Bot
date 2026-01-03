const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const playlistService = require('../services/playlists');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');

const commands = {
  // Save current queue as playlist
  savelist: {
    data: new SlashCommandBuilder()
      .setName('savelist')
      .setDescription('Save the current queue as a personal playlist.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Playlist name (1-32 characters)')
          .setRequired(true)
          .setMaxLength(32)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'The queue is empty. Nothing to save.', ephemeral: true });
      }

      const name = interaction.options.getString('name');
      const { success, error } = await playlistService.savePlaylist(
        interaction.user.id,
        name,
        queue.songs
      );

      if (!success) {
        return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
      }

      return interaction.reply(`✅ Saved **${queue.songs.length}** songs to playlist **${name}**`);
    }
  },

  // Load a saved playlist
  loadlist: {
    data: new SlashCommandBuilder()
      .setName('loadlist')
      .setDescription('Load a saved playlist into the queue.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const voiceChannel = getVoiceChannel(interaction.member);
      if (!voiceChannel) {
        return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
      }

      await interaction.deferReply();

      const name = interaction.options.getString('name');
      const { playlist, error } = await playlistService.loadPlaylist(interaction.user.id, name);

      if (error) {
        return interaction.editReply({ content: `❌ ${error}` });
      }

      // Add requester to songs
      const songs = playlist.songs.map(song => ({
        ...song,
        requester: interaction.user.id
      }));

      const queue = queueManager.getOrCreate(interaction.guildId, voiceChannel);
      const wasEmpty = queue.songs.length === 0;
      
      queueManager.addSongs(interaction.guildId, songs);

      if (wasEmpty) {
        player.playSong(interaction.guildId, queue.songs[0]);
        return interaction.editReply(`▶️ Now playing playlist **${playlist.name}** (${songs.length} songs)`);
      } else {
        return interaction.editReply(`📋 Added playlist **${playlist.name}** (${songs.length} songs) to queue`);
      }
    }
  },

  // Delete a saved playlist
  deletelist: {
    data: new SlashCommandBuilder()
      .setName('deletelist')
      .setDescription('Delete a saved playlist.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
      ),

    async execute(interaction) {
      const name = interaction.options.getString('name');
      const { success, error } = await playlistService.deletePlaylist(interaction.user.id, name);

      if (!success) {
        return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
      }

      return interaction.reply(`🗑️ Deleted playlist **${name}**`);
    }
  },

  // List all saved playlists
  playlists: {
    data: new SlashCommandBuilder()
      .setName('playlists')
      .setDescription('List your saved playlists.'),

    async execute(interaction) {
      const { playlists, error } = await playlistService.listPlaylists(interaction.user.id);

      if (error) {
        return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
      }

      if (playlists.length === 0) {
        return interaction.reply({ 
          content: 'You have no saved playlists. Use `/savelist` to create one!',
          ephemeral: true 
        });
      }

      const embed = new EmbedBuilder()
        .setTitle('📋 Your Playlists')
        .setColor(0x5865F2)
        .setDescription(
          playlists.map((p, i) => 
            `**${i + 1}.** ${p.name} — ${p.songCount} songs`
          ).join('\n')
        )
        .setFooter({ text: `Use /loadlist <name> to play a playlist` });

      return interaction.reply({ embeds: [embed] });
    }
  },

  // Append current queue to existing playlist
  appendlist: {
    data: new SlashCommandBuilder()
      .setName('appendlist')
      .setDescription('Add the current queue to an existing playlist.')
      .addStringOption(option =>
        option.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
      ),

    async execute(interaction) {
      if (!isGuildInteraction(interaction)) {
        return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
      }

      const queue = queueManager.get(interaction.guildId);
      if (!queue || queue.songs.length === 0) {
        return interaction.reply({ content: 'The queue is empty.', ephemeral: true });
      }

      const name = interaction.options.getString('name');
      const { success, error } = await playlistService.appendToPlaylist(
        interaction.user.id,
        name,
        queue.songs
      );

      if (!success) {
        return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
      }

      return interaction.reply(`✅ Added **${queue.songs.length}** songs to playlist **${name}**`);
    }
  }
};

module.exports = commands;
