const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getPlaylist, savePlaylist, deletePlaylist, listPlaylists } = require('../services/playlists');
const { formatDuration } = require('../utils/formatters');

const commands = {
  savelist: {
    data: new SlashCommandBuilder()
      .setName('savelist')
      .setDescription('Save the current queue as a playlist')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
          .setMaxLength(32)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing in the queue to save.', ephemeral: true });
      }
      
      const name = interaction.options.getString('name');
      
      // Get all tracks (current + queue)
      const tracks = [player.queue.current, ...player.queue];
      
      if (tracks.length === 0) {
        return interaction.reply({ content: 'Queue is empty.', ephemeral: true });
      }
      
      // Save playlist
      const playlist = savePlaylist(interaction.user.id, name, tracks);
      
      return interaction.reply(`💾 Saved **${playlist.name}** with ${playlist.tracks.length} tracks.`);
    }
  },

  loadlist: {
    data: new SlashCommandBuilder()
      .setName('loadlist')
      .setDescription('Load and play a saved playlist')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
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
      const name = interaction.options.getString('name');
      const playlist = getPlaylist(interaction.user.id, name);
      
      if (!playlist) {
        return interaction.reply({ content: `Playlist "${name}" not found.`, ephemeral: true });
      }
      
      const member = interaction.member;
      const voiceChannel = member.voice.channel;

      if (!voiceChannel) {
        return interaction.reply({ content: '❌ You need to be in a voice channel.', ephemeral: true });
      }

      await interaction.deferReply();

      try {
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

        // Search and add each track
        let added = 0;
        for (const track of playlist.tracks) {
          try {
            const result = await client.kazagumo.search(track.uri || track.title, {
              requester: interaction.user
            });
            
            if (result?.tracks?.length) {
              player.queue.add(result.tracks[0]);
              added++;
            }
          } catch (e) {
            // Skip failed tracks
          }
        }

        if (!player.playing && !player.paused) {
          player.data.suppressNowPlaying = true;
          player.play();
        }

        return interaction.editReply(`📂 Loaded **${playlist.name}** - added ${added}/${playlist.tracks.length} tracks.`);
      } catch (error) {
        console.error('Loadlist error:', error);
        return interaction.editReply('❌ An error occurred loading the playlist.');
      }
    }
  },

  deletelist: {
    data: new SlashCommandBuilder()
      .setName('deletelist')
      .setDescription('Delete a saved playlist')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
          .setAutocomplete(true)
      ),

    async autocomplete(interaction, client) {
      const focused = interaction.options.getFocused().toLowerCase();
      const playlists = listPlaylists(interaction.user.id);
      
      const filtered = playlists
        .filter(p => p.name.toLowerCase().includes(focused))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(p => ({ name: p.name, value: p.name }))
      );
    },

    async execute(interaction, client) {
      const name = interaction.options.getString('name');
      
      if (deletePlaylist(interaction.user.id, name)) {
        return interaction.reply(`🗑️ Deleted playlist **${name}**`);
      } else {
        return interaction.reply({ content: `Playlist "${name}" not found.`, ephemeral: true });
      }
    }
  },

  playlists: {
    data: new SlashCommandBuilder()
      .setName('playlists')
      .setDescription('View your saved playlists'),

    async execute(interaction, client) {
      const playlists = listPlaylists(interaction.user.id);
      
      if (playlists.length === 0) {
        return interaction.reply({ content: 'You have no saved playlists. Use `/savelist` to create one.', ephemeral: true });
      }
      
      const embed = new EmbedBuilder()
        .setTitle('📋 Your Playlists')
        .setColor('#5865F2')
        .setDescription(
          playlists.map((p, i) => {
            const totalDuration = p.tracks.reduce((sum, t) => sum + (t.length || 0), 0);
            return `**${i + 1}.** ${p.name} - ${p.tracks.length} tracks \`${formatDuration(totalDuration)}\``;
          }).join('\n')
        )
        .setFooter({ text: `${playlists.length} playlists total` });
      
      return interaction.reply({ embeds: [embed] });
    }
  },

  appendlist: {
    data: new SlashCommandBuilder()
      .setName('appendlist')
      .setDescription('Add current queue to an existing playlist')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Playlist name')
          .setRequired(true)
          .setAutocomplete(true)
      ),

    async autocomplete(interaction, client) {
      const focused = interaction.options.getFocused().toLowerCase();
      const playlists = listPlaylists(interaction.user.id);
      
      const filtered = playlists
        .filter(p => p.name.toLowerCase().includes(focused))
        .slice(0, 25);
      
      await interaction.respond(
        filtered.map(p => ({ name: p.name, value: p.name }))
      );
    },

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing in the queue to add.', ephemeral: true });
      }
      
      const name = interaction.options.getString('name');
      const existing = getPlaylist(interaction.user.id, name);
      
      if (!existing) {
        return interaction.reply({ content: `Playlist "${name}" not found. Use \`/savelist\` to create it.`, ephemeral: true });
      }
      
      // Get current tracks
      const newTracks = [player.queue.current, ...player.queue];
      
      // Combine with existing
      const combined = [
        ...existing.tracks.map(t => ({ ...t })),
        ...newTracks
      ];
      
      // Save updated playlist
      const playlist = savePlaylist(interaction.user.id, existing.name, combined);
      
      return interaction.reply(`➕ Added ${newTracks.length} tracks to **${playlist.name}** (now ${playlist.tracks.length} total)`);
    }
  }
};

module.exports = commands;
