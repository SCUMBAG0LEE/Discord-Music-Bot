const { SlashCommandBuilder } = require('discord.js');
const { queueManager } = require('../services/queueManager');
const player = require('../services/player');
const spotifyService = require('../services/spotify');
const youtubeService = require('../services/youtube');
const soundcloudService = require('../services/soundcloud');
const radioService = require('../services/radio');
const { getVoiceChannel, isGuildInteraction } = require('../utils/permissions');
const { logger } = require('../utils/logger');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play from YouTube, Spotify, SoundCloud, or a direct URL/stream.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL, search term, or radio preset (lofi, jazz, classical, chillhop, synthwave)')
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

    logger.command('play', requesterId, guildId, { query: query.substring(0, 100) });

    try {
      // Check for radio preset first
      const presetUrl = radioService.getPresetStation(query);
      if (presetUrl) {
        logger.urlDetection(query, 'radio-preset');
        return await handleStream(interaction, query, voiceChannel, guildId, requesterId, true);
      }

      // Handle Spotify URLs
      if (spotifyService.isSpotifyUrl(query)) {
        logger.urlDetection(query, 'spotify');
        return await handleSpotify(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Handle YouTube URLs (check BEFORE SoundCloud to avoid false positives)
      if (youtubeService.isYouTubeUrl(query)) {
        if (youtubeService.isPlaylistUrl(query)) {
          logger.urlDetection(query, 'youtube-playlist');
          return await handleYouTubePlaylist(interaction, query, voiceChannel, guildId, requesterId);
        }
        logger.urlDetection(query, 'youtube-video');
        return await handleYouTubeVideoOrSearch(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Handle SoundCloud URLs
      if (soundcloudService.isSoundCloudUrl(query)) {
        logger.urlDetection(query, 'soundcloud');
        return await handleSoundCloud(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Handle direct streams/radio URLs
      if (radioService.isStreamUrl(query) || radioService.isDirectUrl(query)) {
        logger.urlDetection(query, 'stream/direct-url');
        return await handleStream(interaction, query, voiceChannel, guildId, requesterId);
      }

      // Fallback: treat as YouTube search
      logger.urlDetection(query, 'youtube-search');
      return await handleYouTubeVideoOrSearch(interaction, query, voiceChannel, guildId, requesterId);

    } catch (error) {
      logger.error('Play', `Command failed for query: ${query.substring(0, 50)}`, error);
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

async function handleSoundCloud(interaction, query, voiceChannel, guildId, requesterId) {
  const resourceType = soundcloudService.getResourceType(query);

  if (resourceType === 'track') {
    const { song, error } = await soundcloudService.getTrack(query, requesterId);
    if (error) {
      return interaction.editReply({ content: error });
    }
    return addSongsToQueue(interaction, [song], voiceChannel, guildId, `SoundCloud track`);
  }

  if (resourceType === 'playlist') {
    const { songs, name, error } = await soundcloudService.getPlaylist(query, requesterId);
    if (error) {
      return interaction.editReply({ content: error });
    }
    return addSongsToQueue(interaction, songs, voiceChannel, guildId, `SoundCloud playlist: **${name}**`);
  }

  return interaction.editReply({ content: 'Unsupported SoundCloud URL type.' });
}

async function handleStream(interaction, query, voiceChannel, guildId, requesterId, isPreset = false) {
  const { song, error } = await radioService.getStream(query, requesterId);
  
  if (error) {
    return interaction.editReply({ content: error });
  }
  
  const label = isPreset ? `📻 Radio: **${query}**` : '📻 Stream';
  return addSongsToQueue(interaction, [song], voiceChannel, guildId, label);
}

async function handleYouTubePlaylist(interaction, query, voiceChannel, guildId, requesterId) {
  const { songs, name, error } = await youtubeService.getPlaylist(query, requesterId);
  
  if (error) {
    return interaction.editReply({ content: error });
  }
  
  return addSongsToQueue(interaction, songs, voiceChannel, guildId, `YouTube playlist: **${name}**`);
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
  
  logger.queue(guildId, 'addSongs', { 
    count: songs.length, 
    wasEmpty,
    firstSong: songs[0]?.title?.substring(0, 50)
  });
  
  queueManager.addSongs(guildId, songs);

  if (wasEmpty) {
    logger.player(guildId, 'startPlayback', { title: songs[0]?.title });
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
