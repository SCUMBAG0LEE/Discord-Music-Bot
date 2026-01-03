const { SlashCommandBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const spotifyService = require('../services/spotify');
const youtubeService = require('../services/youtube');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube video, playlist, Spotify track, playlist, album, or search term.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('YouTube URL, Spotify URL, or search term')
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

    const query = interaction.options.getString('query');
    const guildId = interaction.guildId;
    const requesterId = interaction.user.id;

    try {
      // Handle Spotify URLs
      if (spotifyService.isSpotifyUrl(query)) {
        return await handleSpotify(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Handle YouTube Playlist
      if (youtubeService.isPlaylistUrl(query)) {
        return await handleYouTubePlaylist(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Handle YouTube Video or Search
      return await handleYouTubeVideoOrSearch(interaction, query, voiceChannel, guildId, requesterId);

    } catch (error) {
      console.error('Play command error:', error);
      return interaction.editReply({ content: 'An error occurred while processing your request.' });
    }
  }
};

async function handleSpotify(interaction, query, voiceChannel, guildId, requesterId) {
  const resourceType = spotifyService.getResourceType(query);

  if (resourceType === 'track') {
    const { song, error } = await spotifyService.getTrack(query, requesterId);
    if (error) {
      return interaction.editReply({ content: error });
    }
    return addSongsToQueue(interaction, [song], voiceChannel, guildId, `Spotify track`);
  }

  if (resourceType === 'playlist') {
    const { songs, name, error } = await spotifyService.getPlaylist(query, requesterId);
    if (error) {
      return interaction.editReply({ content: error });
    }
    return addSongsToQueue(interaction, songs, voiceChannel, guildId, `Spotify playlist: **${name}**`);
  }

  if (resourceType === 'album') {
    const { songs, name, error } = await spotifyService.getAlbum(query, requesterId);
    if (error) {
      return interaction.editReply({ content: error });
    }
    return addSongsToQueue(interaction, songs, voiceChannel, guildId, `Spotify album: **${name}**`);
  }

  return interaction.editReply({ content: 'Unsupported Spotify URL type.' });
}

async function handleYouTubePlaylist(interaction, query, voiceChannel, guildId, requesterId) {
  const { songs, name, error } = await youtubeService.getPlaylist(query, requesterId);
  
  if (error) {
    return interaction.editReply({ content: error });
  }
  
  return addSongsToQueue(interaction, songs, voiceChannel, guildId, `playlist: **${name}**`);
}

async function handleYouTubeVideoOrSearch(interaction, query, voiceChannel, guildId, requesterId) {
  let result;
  
  if (youtubeService.isVideoUrl(query)) {
    result = await youtubeService.getVideo(query, requesterId);
  } else {
    result = await youtubeService.searchAndGetFirst(query, requesterId);
  }

  if (result.error) {
    return interaction.editReply({ content: result.error });
  }

  return addSongsToQueue(interaction, [result.song], voiceChannel, guildId);
}

async function addSongsToQueue(interaction, songs, voiceChannel, guildId, sourceLabel = null) {
  const queue = queueManager.getOrCreate(guildId, voiceChannel);
  const wasEmpty = queue.songs.length === 0;
  
  queueManager.addSongs(guildId, songs);

  if (wasEmpty) {
    player.playSong(guildId, queue.songs[0]);
    
    if (songs.length === 1) {
      return interaction.editReply(`Now playing: **${songs[0].title}**`);
    } else {
      return interaction.editReply(`Now playing ${sourceLabel} with ${songs.length} tracks.`);
    }
  } else {
    if (songs.length === 1) {
      return interaction.editReply(`Added to queue: **${songs[0].title}**`);
    } else {
      return interaction.editReply(`Added ${sourceLabel} (${songs.length} tracks) to the queue.`);
    }
  }
}
