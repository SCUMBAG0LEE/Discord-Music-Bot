/**
 * YouTube.js Plugin for DisTube
 * Uses youtubei.js (InnerTube API) for reliable YouTube playback
 * 
 * Benefits over ytdl-core / yt-dlp:
 * - Pure JavaScript, no external binaries needed
 * - Actively maintained
 * - Direct access to YouTube's InnerTube API
 * - Better handling of YouTube's anti-bot measures
 * - Supports cookie-based authentication for age-restricted content
 */

const { PlayableExtractorPlugin, Song, Playlist } = require('distube');
const { Innertube } = require('youtubei.js');
const fs = require('fs');
const path = require('path');

/** @type {Innertube|null} */
let innertube = null;

/** @type {string|null} */
let cookieString = null;

/**
 * Load YouTube cookies from file
 * @returns {string|null}
 */
function loadCookies() {
  const cookiePath = path.join(process.cwd(), 'youtube-cookies.txt');
  
  // Try plain text cookie file first (recommended format)
  if (fs.existsSync(cookiePath)) {
    try {
      const content = fs.readFileSync(cookiePath, 'utf8').trim();
      if (content) {
        console.log('[YouTube.js] Loaded cookies from youtube-cookies.txt');
        return content;
      }
    } catch (err) {
      console.warn('[YouTube.js] Failed to load youtube-cookies.txt:', err.message);
    }
  }
  
  // Also try JSON format for backwards compatibility
  const jsonCookiePath = path.join(process.cwd(), 'youtube-cookies.json');
  if (fs.existsSync(jsonCookiePath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(jsonCookiePath, 'utf8'));
      // Convert JSON cookie array to cookie string
      if (Array.isArray(cookies)) {
        const cookieStr = cookies
          .map(c => `${c.name}=${c.value}`)
          .join('; ');
        console.log('[YouTube.js] Loaded cookies from youtube-cookies.json');
        return cookieStr;
      }
    } catch (err) {
      console.warn('[YouTube.js] Failed to load youtube-cookies.json:', err.message);
    }
  }
  
  return null;
}

/**
 * Initialize or get the Innertube instance
 * @param {string|null} cookie - Optional cookie string
 * @returns {Promise<Innertube>}
 */
async function getInnertube(cookie = null) {
  // If cookie changed or first init, recreate instance
  if (!innertube || (cookie && cookie !== cookieString)) {
    cookieString = cookie || loadCookies();
    
    const options = {
      lang: 'en',
      location: 'US',
      retrieve_player: true,
      enable_session_cache: true,
      generate_session_locally: true
    };
    
    // Add cookie if available
    if (cookieString) {
      options.cookie = cookieString;
    }
    
    innertube = await Innertube.create(options);
  }
  return innertube;
}

/**
 * Check if a URL is a YouTube URL
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeURL(url) {
  if (typeof url !== 'string') return false;
  
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch\?v=/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
    /^https?:\/\/(www\.)?youtube\.com\/playlist\?list=/,
    /^https?:\/\/youtu\.be\//,
    /^https?:\/\/music\.youtube\.com\/watch\?v=/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\//,
    /^https?:\/\/(www\.)?youtube\.com\/v\//
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

/**
 * Extract video ID from YouTube URL
 * @param {string} url
 * @returns {string|null}
 */
function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/  // Just the ID
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Extract playlist ID from YouTube URL
 * @param {string} url
 * @returns {string|null}
 */
function extractPlaylistId(url) {
  const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

/**
 * Get the best audio format from streaming data
 * @param {object} streamingData
 * @returns {object|null}
 */
function getBestAudioFormat(streamingData) {
  if (!streamingData?.adaptive_formats) return null;
  
  // Filter for audio-only formats
  const audioFormats = streamingData.adaptive_formats.filter(f => 
    f.has_audio && !f.has_video
  );
  
  if (audioFormats.length === 0) return null;
  
  // Prefer opus/webm, then sort by bitrate
  const opusFormats = audioFormats.filter(f => 
    f.mime_type?.includes('audio/webm') || f.mime_type?.includes('opus')
  );
  
  const formats = opusFormats.length > 0 ? opusFormats : audioFormats;
  formats.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  
  return formats[0];
}

class YouTubeJsPlugin extends PlayableExtractorPlugin {
  constructor(options = {}) {
    super();
    this.options = {
      cookie: options.cookie || null,
      ...options
    };
  }

  init(distube) {
    super.init(distube);
    
    // Pre-initialize Innertube in the background
    getInnertube().then(() => {
      console.log('[YouTube.js] Initialized successfully');
    }).catch(err => {
      console.warn('[YouTube.js] Failed to initialize:', err.message);
    });
  }

  validate(url) {
    return isYouTubeURL(url);
  }

  async resolve(url, options) {
    const yt = await getInnertube();
    
    // Check if it's a playlist
    const playlistId = extractPlaylistId(url);
    if (playlistId && !url.includes('watch?v=')) {
      return this.resolvePlaylist(yt, playlistId, options);
    }
    
    // Single video
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new Error('[YouTube.js] Could not extract video ID from URL');
    }
    
    return this.resolveVideo(yt, videoId, options);
  }

  async resolveVideo(yt, videoId, options) {
    const info = await yt.getBasicInfo(videoId);
    
    if (!info.basic_info) {
      throw new Error('[YouTube.js] Failed to get video info');
    }
    
    if (info.playability_status?.status === 'ERROR') {
      throw new Error(`[YouTube.js] ${info.playability_status.reason || 'Video unavailable'}`);
    }
    
    return this.createSong(info, options);
  }

  async resolvePlaylist(yt, playlistId, options) {
    const playlist = await yt.getPlaylist(playlistId);
    
    if (!playlist) {
      throw new Error('[YouTube.js] Playlist not found');
    }
    
    const songs = [];
    
    // Get videos from playlist
    const videos = playlist.videos || [];
    for (const video of videos) {
      if (video.id) {
        try {
          const songInfo = {
            basic_info: {
              id: video.id,
              title: video.title?.text || video.title || 'Unknown',
              duration: video.duration?.seconds || 0,
              thumbnail: video.thumbnails?.[0]?.url || null,
              channel: {
                name: video.author?.name || video.channel?.name || 'Unknown',
                url: video.author?.url || video.channel?.url || null
              },
              view_count: video.view_count?.text ? parseInt(video.view_count.text.replace(/[^0-9]/g, '')) : 0
            }
          };
          songs.push(this.createSong(songInfo, options, false));
        } catch (err) {
          console.warn(`[YouTube.js] Failed to add playlist video ${video.id}:`, err.message);
        }
      }
    }
    
    if (songs.length === 0) {
      throw new Error('[YouTube.js] No playable videos found in playlist');
    }
    
    return new Playlist({
      source: 'youtube',
      songs,
      name: playlist.info?.title || 'YouTube Playlist',
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      thumbnail: playlist.info?.thumbnails?.[0]?.url || songs[0]?.thumbnail
    }, options);
  }

  createSong(info, options, includeStreamUrl = true) {
    const basicInfo = info.basic_info;
    
    const songData = {
      plugin: this,
      source: 'youtube',
      playFromSource: true,
      id: basicInfo.id,
      name: basicInfo.title || 'Unknown',
      url: `https://www.youtube.com/watch?v=${basicInfo.id}`,
      thumbnail: basicInfo.thumbnail?.[0]?.url || 
                 (Array.isArray(basicInfo.thumbnail) ? basicInfo.thumbnail[0]?.url : null) ||
                 `https://i.ytimg.com/vi/${basicInfo.id}/hqdefault.jpg`,
      duration: basicInfo.duration || 0,
      views: basicInfo.view_count || 0,
      likes: basicInfo.like_count || 0,
      isLive: basicInfo.is_live || false,
      uploader: {
        name: basicInfo.channel?.name || basicInfo.author || 'Unknown',
        url: basicInfo.channel?.url || null
      }
    };
    
    const song = new Song(songData, options);
    
    // Cache streaming data if available
    if (includeStreamUrl && info.streaming_data) {
      song._ytjsStreamingData = info.streaming_data;
    }
    
    return song;
  }

  async getStreamURL(song) {
    const yt = await getInnertube();
    
    // If we have cached streaming data, try to use it
    let streamingData = song._ytjsStreamingData;
    
    // If no cached data or it might be expired, fetch fresh
    if (!streamingData) {
      const videoId = extractVideoId(song.url) || song.id;
      const info = await yt.getBasicInfo(videoId);
      streamingData = info.streaming_data;
    }
    
    if (!streamingData) {
      throw new Error('[YouTube.js] No streaming data available');
    }
    
    const format = getBestAudioFormat(streamingData);
    if (!format) {
      throw new Error('[YouTube.js] No suitable audio format found');
    }
    
    // Get the deciphered URL
    const url = format.decipher(yt.session.player);
    
    if (!url) {
      throw new Error('[YouTube.js] Failed to decipher stream URL');
    }
    
    return url;
  }

  async getRelatedSongs(song) {
    try {
      const yt = await getInnertube();
      const videoId = extractVideoId(song.url) || song.id;
      const info = await yt.getInfo(videoId);
      
      const related = info.related_videos || info.watch_next_feed || [];
      const songs = [];
      
      for (const video of related.slice(0, 5)) {
        if (video.id && video.title) {
          try {
            const relatedInfo = {
              basic_info: {
                id: video.id,
                title: video.title?.text || video.title || 'Unknown',
                duration: video.duration?.seconds || 0,
                thumbnail: video.thumbnails?.[0]?.url || null,
                channel: {
                  name: video.author?.name || 'Unknown',
                  url: video.author?.url || null
                }
              }
            };
            songs.push(this.createSong(relatedInfo, {}, false));
          } catch (err) {
            // Skip failed videos
          }
        }
      }
      
      return songs;
    } catch (err) {
      console.warn('[YouTube.js] Failed to get related songs:', err.message);
      return [];
    }
  }

  /**
   * Search YouTube for videos
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Promise<Array>}
   */
  async search(query, limit = 10) {
    const yt = await getInnertube();
    const results = await yt.search(query, { type: 'video' });
    
    const videos = [];
    const videoResults = results.videos || [];
    
    for (const video of videoResults.slice(0, limit)) {
      if (video.id) {
        videos.push({
          id: video.id,
          title: video.title?.text || video.title || 'Unknown',
          url: `https://www.youtube.com/watch?v=${video.id}`,
          duration: video.duration?.seconds || 0,
          durationFormatted: video.duration?.text || '0:00',
          thumbnail: video.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
          channel: video.author?.name || 'Unknown',
          views: video.view_count?.text || '0 views'
        });
      }
    }
    
    return videos;
  }
}

module.exports = { YouTubeJsPlugin, getInnertube, isYouTubeURL, extractVideoId };
