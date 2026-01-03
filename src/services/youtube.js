const play = require('play-dl');

/**
 * Check if URL is any valid YouTube URL (video or playlist)
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  // Check using play-dl validator
  const validation = play.yt_validate(url);
  if (validation === 'video' || validation === 'playlist') {
    return true;
  }
  // Fallback regex for edge cases (youtu.be, youtube.com, music.youtube.com)
  const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/i;
  return ytRegex.test(url);
}

/**
 * Check if URL is a valid YouTube video URL
 * @param {string} url
 * @returns {boolean}
 */
function isVideoUrl(url) {
  return play.yt_validate(url) === 'video';
}

/**
 * Check if URL is a valid YouTube playlist URL
 * @param {string} url
 * @returns {boolean}
 */
function isPlaylistUrl(url) {
  return play.yt_validate(url) === 'playlist';
}

/**
 * Get video info from URL
 * @param {string} url - YouTube video URL
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getVideo(url, requesterId) {
  try {
    const info = await play.video_basic_info(url);
    const details = info.video_details;
    
    const song = {
      title: details.title,
      url: details.url,
      duration: details.durationInSec || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: details.url,
      thumbnail: details.thumbnails?.[0]?.url || null
    };
    return { song, error: null };
  } catch (err) {
    console.error('YouTube getVideo error:', err.message);
    return { song: null, error: 'Error fetching video details.' };
  }
}

/**
 * Get playlist videos
 * @param {string} url - YouTube playlist URL
 * @param {string} requesterId - Discord user ID
 * @param {number} [limit=50] - Maximum number of videos to fetch
 * @returns {Promise<{songs: Object[], name: string|null, error: string|null}>}
 */
async function getPlaylist(url, requesterId, limit = 50) {
  try {
    const playlist = await play.playlist_info(url, { incomplete: true });
    const videos = await playlist.all_videos();
    
    const songs = videos.slice(0, limit).map(video => ({
      title: video.title,
      url: video.url,
      duration: video.durationInSec || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: video.url,
      thumbnail: video.thumbnails?.[0]?.url || null
    }));
    
    return { songs, name: playlist.title, error: null };
  } catch (err) {
    console.error('YouTube getPlaylist error:', err.message);
    return { songs: [], name: null, error: 'Error fetching playlist details.' };
  }
}

/**
 * Search YouTube for videos
 * @param {string} query - Search query
 * @param {number} [maxResults=5] - Maximum number of results
 * @returns {Promise<Object[]>}
 */
async function search(query, maxResults = 5) {
  try {
    const results = await play.search(query, { source: { youtube: 'video' }, limit: maxResults });
    return results.map(video => ({
      title: video.title,
      url: video.url,
      duration: video.durationInSec || 0,
      author: video.channel?.name || 'Unknown',
      thumbnail: video.thumbnails?.[0]?.url || null
    }));
  } catch (err) {
    console.error('YouTube search error:', err.message);
    return [];
  }
}

/**
 * Search and get first result as song
 * @param {string} query - Search query
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function searchAndGetFirst(query, requesterId) {
  try {
    const results = await play.search(query, { source: { youtube: 'video' }, limit: 1 });
    
    if (!results.length) {
      return { song: null, error: 'No video results found.' };
    }
    
    const video = results[0];
    const song = {
      title: video.title,
      url: video.url,
      duration: video.durationInSec || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: video.url,
      thumbnail: video.thumbnails?.[0]?.url || null
    };
    
    return { song, error: null };
  } catch (err) {
    console.error('YouTube searchAndGetFirst error:', err.message);
    return { song: null, error: 'Error searching YouTube.' };
  }
}

/**
 * Search YouTube using Spotify track info
 * @param {Object} track - Spotify track object (from play-dl)
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<Object|null>}
 */
async function searchFromSpotifyTrack(track, requesterId) {
  const searchQuery = `${track.name} ${track.artists.map(a => a.name).join(' ')}`;
  
  try {
    const results = await play.search(searchQuery, { source: { youtube: 'video' }, limit: 1 });
    
    if (!results.length) {
      return null;
    }
    
    const video = results[0];
    return {
      title: video.title,
      url: video.url,
      duration: video.durationInSec || 0,
      requester: requesterId,
      thumbnail: video.thumbnails?.[0]?.url || null
    };
  } catch (err) {
    console.error('YouTube searchFromSpotifyTrack error:', err.message);
    return null;
  }
}

/**
 * Create audio stream from URL
 * @param {string} url - YouTube video URL
 * @returns {Promise<import('stream').Readable>}
 */
async function createStream(url) {
  const stream = await play.stream(url);
  return stream.stream;
}

/**
 * Get stream type for audio resource creation
 * @param {string} url - YouTube video URL  
 * @param {number} [seekTime=0] - Time in seconds to start from
 * @returns {Promise<{stream: import('stream').Readable, type: string}>}
 */
async function getStreamWithType(url, seekTime = 0) {
  const options = {};
  
  if (seekTime > 0) {
    options.seek = seekTime;
  }
  
  const streamData = await play.stream(url, options);
  return {
    stream: streamData.stream,
    type: streamData.type
  };
}

module.exports = {
  isYouTubeUrl,
  isVideoUrl,
  isPlaylistUrl,
  getVideo,
  getPlaylist,
  search,
  searchAndGetFirst,
  searchFromSpotifyTrack,
  createStream,
  getStreamWithType
};
