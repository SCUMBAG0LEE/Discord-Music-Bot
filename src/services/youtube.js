const play = require('play-dl');
const { logger } = require('../utils/logger');

/**
 * Initialize YouTube authentication
 * Uses OAuth tokens from .data/youtube.data (created by setup-youtube.js)
 * Tokens auto-refresh, no manual cookie management needed!
 */
async function initialize() {
  try {
    // Check if tokens exist and need refresh
    // play.is_expired() returns boolean, not a promise
    let expired = true;
    try {
      expired = play.is_expired();
    } catch {
      // No tokens exist
    }
    
    if (expired) {
      logger.info('YouTube', 'Refreshing OAuth tokens...');
      await play.refreshToken();
      logger.success('YouTube', 'Tokens refreshed successfully');
    } else {
      logger.success('YouTube', 'OAuth tokens are valid');
    }
  } catch (err) {
    // Not fatal - might work without auth for some videos
    logger.warn('YouTube', 'No YouTube authorization found');
    logger.info('YouTube', 'Run "node setup-youtube.js" to authorize (recommended)');
    logger.info('YouTube', 'Without auth, some videos may fail with "Invalid URL" errors');
  }
}

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
    // Normalize URL first to handle youtu.be and tracking params
    const normalizedUrl = normalizeUrl(url);
    logger.debug('YouTube', `getVideo: "${url}" → normalized: "${normalizedUrl}"`);
    
    const info = await play.video_basic_info(normalizedUrl);
    const details = info.video_details;
    
    const song = {
      title: details.title,
      url: normalizedUrl, // Always use normalized URL to avoid streaming issues
      duration: details.durationInSec || 0,
      requester: requesterId,
      source: 'youtube',
      sourceUrl: normalizedUrl,
      thumbnail: details.thumbnails?.[0]?.url || null
    };
    
    logger.info('YouTube', `Fetched video: "${song.title}" (${song.duration}s)`);
    return { song, error: null };
  } catch (err) {
    logger.error('YouTube', `getVideo failed for: ${url}`, err);
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
    logger.error('YouTube', `getPlaylist failed for: ${url}`, err);
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
    logger.error('YouTube', `Search failed for: ${query}`, err);
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
    
    logger.info('YouTube', `Search result: "${song.title}"`);
    return { song, error: null };
  } catch (err) {
    logger.error('YouTube', `searchAndGetFirst failed for: ${query}`, err);
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
    logger.error('YouTube', `searchFromSpotifyTrack failed for: ${searchQuery}`, err);
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
 * Extract video ID from various YouTube URL formats
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Normalize YouTube URL to standard format
 * @param {string} url
 * @returns {string}
 */
function normalizeUrl(url) {
  const videoId = extractVideoId(url);
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }
  return url;
}

/**
 * Get stream type for audio resource creation
 * @param {string} url - YouTube video URL  
 * @param {number} [seekTime=0] - Time in seconds to start from
 * @returns {Promise<{stream: import('stream').Readable, type: string}>}
 */
async function getStreamWithType(url, seekTime = 0) {
  // Normalize the URL to avoid issues with short URLs and tracking params
  const normalizedUrl = normalizeUrl(url);
  
  logger.debug('YouTube', `getStreamWithType: input="${url}"`);
  logger.debug('YouTube', `getStreamWithType: normalized="${normalizedUrl}", seekTime=${seekTime}`);
  
  try {
    // Method 1: Try using video_info + stream_from_info (more reliable)
    logger.debug('YouTube', 'Attempting stream via video_info...');
    const info = await play.video_info(normalizedUrl);
    
    if (!info || !info.video_details) {
      throw new Error('Failed to get video info');
    }
    
    logger.debug('YouTube', `Got video info: "${info.video_details.title}"`);
    
    const options = seekTime > 0 ? { seek: seekTime } : undefined;
    const streamData = await play.stream_from_info(info, options);
    
    logger.stream('youtube', normalizedUrl, `success via video_info (type: ${streamData.type})`);
    
    return {
      stream: streamData.stream,
      type: streamData.type
    };
  } catch (err) {
    logger.warn('YouTube', `video_info method failed: ${err.message}`);
    
    // Method 2: Fallback to direct stream (original method)
    try {
      logger.debug('YouTube', 'Attempting direct stream fallback...');
      const streamData = seekTime > 0 
        ? await play.stream(normalizedUrl, { seek: seekTime })
        : await play.stream(normalizedUrl);
      
      logger.stream('youtube', normalizedUrl, `success via direct stream (type: ${streamData.type})`);
      
      return {
        stream: streamData.stream,
        type: streamData.type
      };
    } catch (fallbackErr) {
      logger.error('YouTube', `All streaming methods failed for: ${normalizedUrl}`, fallbackErr);
      
      // Provide helpful error message
      if (fallbackErr.message.includes('Invalid URL') || err.message.includes('Invalid URL')) {
        logger.error('YouTube', 'This error usually means YouTube is blocking requests.');
        logger.error('YouTube', 'Solution: Run "node setup-youtube.js" to authorize with Google OAuth');
      }
      
      throw fallbackErr;
    }
  }
}

module.exports = {
  initialize,
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
