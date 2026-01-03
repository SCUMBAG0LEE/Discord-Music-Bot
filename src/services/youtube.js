const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');
const ytpl = require('@distube/ytpl');

/**
 * Check if URL is a valid YouTube video URL
 * @param {string} url
 * @returns {boolean}
 */
function isVideoUrl(url) {
  return ytdl.validateURL(url);
}

/**
 * Check if URL is a valid YouTube playlist URL
 * @param {string} url
 * @returns {boolean}
 */
function isPlaylistUrl(url) {
  return ytpl.validateID(url);
}

/**
 * Get video info from URL
 * @param {string} url - YouTube video URL
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getVideo(url, requesterId) {
  try {
    const info = await ytdl.getInfo(url);
    const song = {
      title: info.videoDetails.title,
      url: info.videoDetails.video_url,
      duration: parseInt(info.videoDetails.lengthSeconds) || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: info.videoDetails.video_url
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
    const playlist = await ytpl(url, { limit });
    const songs = playlist.items.map(item => ({
      title: item.title,
      url: item.shortUrl,
      duration: parseInt(item.durationSec) || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: item.shortUrl
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
    const result = await ytSearch(query);
    return result.videos.slice(0, maxResults);
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
    const result = await ytSearch(query);
    
    if (!result.videos.length) {
      return { song: null, error: 'No video results found.' };
    }
    
    const video = result.videos[0];
    const song = {
      title: video.title,
      url: video.url,
      duration: video.seconds || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: video.url
    };
    
    return { song, error: null };
  } catch (err) {
    console.error('YouTube searchAndGetFirst error:', err.message);
    return { song: null, error: 'Error searching YouTube.' };
  }
}

/**
 * Search YouTube using Spotify track info
 * @param {Object} track - Spotify track object
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<Object|null>}
 */
async function searchFromSpotifyTrack(track, requesterId) {
  const searchQuery = `${track.name} ${track.artists.map(a => a.name).join(' ')}`;
  
  try {
    const result = await ytSearch(searchQuery);
    
    if (!result.videos.length) {
      return null;
    }
    
    const video = result.videos[0];
    return {
      title: video.title,
      url: video.url,
      duration: video.seconds || 0,
      requester: requesterId
    };
  } catch (err) {
    console.error('YouTube searchFromSpotifyTrack error:', err.message);
    return null;
  }
}

/**
 * Create audio stream from URL
 * @param {string} url - YouTube video URL
 * @returns {import('stream').Readable}
 */
function createStream(url) {
  return ytdl(url, {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25, // 32MB buffer for smoother playback
  });
}

module.exports = {
  isVideoUrl,
  isPlaylistUrl,
  getVideo,
  getPlaylist,
  search,
  searchAndGetFirst,
  searchFromSpotifyTrack,
  createStream
};
