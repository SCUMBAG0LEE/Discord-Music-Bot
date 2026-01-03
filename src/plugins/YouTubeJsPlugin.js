/**
 * YouTube.js Plugin for DisTube
 * Uses youtubei.js (InnerTube API) for reliable YouTube playback
 * Falls back to yt-dlp when YouTube.js fails (more actively maintained against blocks)
 * 
 * Benefits of YouTube.js:
 * - Pure JavaScript, no external binaries needed
 * - Direct access to YouTube's InnerTube API
 * 
 * Benefits of yt-dlp fallback:
 * - Actively maintained by dedicated team fighting YouTube blocks
 * - More reliable when YouTube tightens restrictions
 */

const { PlayableExtractorPlugin, Song, Playlist } = require('distube');
const { Innertube, Platform } = require('youtubei.js');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

// Set up custom JavaScript evaluator for deciphering URLs
// This is required because YouTube.js needs to execute YouTube's obfuscated JS
Platform.shim.eval = async (data, env) => {
  const properties = [];

  if (env.n) {
    properties.push(`n: exportedVars.nFunction("${env.n}")`);
  }

  if (env.sig) {
    properties.push(`sig: exportedVars.sigFunction("${env.sig}")`);
  }

  const code = `${data.output}\nreturn { ${properties.join(', ')} }`;

  // Use Function constructor to evaluate the code safely
  return new Function(code)();
};

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

/**
 * Verify that a stream URL is accessible (returns 200/206 status)
 * Uses HEAD request with proper headers to avoid 403 errors
 * @param {string} url - The URL to verify
 * @param {object} headers - Headers to send with the request
 * @returns {Promise<boolean>} - True if URL is accessible
 */
function verifyStreamURL(url, headers = {}) {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    
    const options = {
      method: 'HEAD',
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
        ...headers
      },
      timeout: 5000
    };

    const req = client.request(options, (res) => {
      // 200 OK or 206 Partial Content are valid
      resolve(res.statusCode === 200 || res.statusCode === 206);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Client configurations with their specific headers
 * Some clients need specific headers for FFmpeg to work
 */
const CLIENT_CONFIGS = {
  WEB_EMBEDDED: {
    headers: {
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/'
    }
  },
  TVHTML5_SIMPLY_EMBEDDED_PLAYER: {
    headers: {
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/'
    }
  },
  TV: {
    headers: {
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com/'
    }
  },
  WEB_CREATOR: {
    headers: {
      'Origin': 'https://studio.youtube.com',
      'Referer': 'https://studio.youtube.com/'
    }
  },
  IOS: {
    headers: {
      'User-Agent': 'com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)'
    }
  },
  ANDROID: {
    headers: {
      'User-Agent': 'com.google.android.youtube/19.29.37 (Linux; U; Android 14) gzip'
    }
  }
};

/**
 * Check if yt-dlp is installed and find its path
 * @returns {Promise<string|null>} - Returns the path to yt-dlp or null if not found
 */
let ytdlpPath = undefined; // undefined = not checked, null = not found, string = path
async function findYtdlp() {
  if (ytdlpPath !== undefined) return ytdlpPath;
  
  // Common paths where yt-dlp might be installed
  const possiblePaths = [
    'yt-dlp',                                    // In PATH
    '/usr/local/bin/yt-dlp',                     // System-wide install
    '/usr/bin/yt-dlp',                           // Package manager install
    `${process.env.HOME}/.local/bin/yt-dlp`,     // pip user install (Linux)
  ];
  
  for (const tryPath of possiblePaths) {
    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(tryPath, ['--version'], { stdio: 'pipe' });
        let version = '';
        proc.stdout?.on('data', (d) => { version += d.toString(); });
        proc.on('error', () => resolve(null));
        proc.on('close', (code) => {
          resolve(code === 0 ? version.trim() : null);
        });
      });
      
      if (result) {
        console.log(`[yt-dlp] Found at ${tryPath} (version ${result})`);
        ytdlpPath = tryPath;
        return ytdlpPath;
      }
    } catch {
      continue;
    }
  }
  
  console.log('[yt-dlp] Not found in any known location');
  ytdlpPath = null;
  return null;
}

/**
 * Convert JSON cookies to Netscape format for yt-dlp
 * @param {Array} cookies - Array of cookie objects
 * @returns {string} - Netscape format cookie string
 */
function convertToNetscapeFormat(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Generated by DiscordMusicBot'];
  
  for (const c of cookies) {
    const domain = c.domain || '.youtube.com';
    const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
    const path = c.path || '/';
    const secure = c.secure ? 'TRUE' : 'FALSE';
    const expiry = Math.floor(c.expirationDate || (Date.now() / 1000 + 86400 * 365));
    const name = c.name;
    const value = c.value;
    
    lines.push(`${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expiry}\t${name}\t${value}`);
  }
  
  return lines.join('\n');
}

/** @type {string|null} */
let tempCookieFile = null;

// Cleanup temp cookie file on process exit
process.on('exit', () => {
  if (tempCookieFile && fs.existsSync(tempCookieFile)) {
    try { fs.unlinkSync(tempCookieFile); } catch {}
  }
});

/**
 * Get stream URL using yt-dlp (fallback when YouTube.js fails)
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<{url: string, headers: object}|null>}
 */
async function getStreamURLWithYtdlp(videoId) {
  const ytdlp = await findYtdlp();
  if (!ytdlp) {
    console.log('[yt-dlp] Not installed, cannot use as fallback');
    return null;
  }

  return new Promise((resolve) => {
    console.log(`[yt-dlp] Trying to get URL for ${videoId}...`);
    
    const args = [
      '-f', 'bestaudio/best',  // More flexible format selector
      '-g',  // Get URL only
      '--no-warnings',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`
    ];
    
    // Add cookies if available
    const txtCookiePath = path.join(process.cwd(), 'youtube-cookies.txt');
    const jsonCookiePath = path.join(process.cwd(), 'youtube-cookies.json');
    
    if (fs.existsSync(txtCookiePath)) {
      // Netscape format - yt-dlp native support
      args.unshift('--cookies', txtCookiePath);
      console.log('[yt-dlp] Using cookies from youtube-cookies.txt');
    } else if (fs.existsSync(jsonCookiePath)) {
      // JSON format - convert to Netscape format temp file
      try {
        const cookies = JSON.parse(fs.readFileSync(jsonCookiePath, 'utf8'));
        if (Array.isArray(cookies) && cookies.length > 0) {
          // Create temp cookie file in Netscape format
          if (!tempCookieFile) {
            tempCookieFile = path.join(process.cwd(), '.yt-dlp-cookies.txt');
          }
          fs.writeFileSync(tempCookieFile, convertToNetscapeFormat(cookies));
          args.unshift('--cookies', tempCookieFile);
          console.log('[yt-dlp] Using cookies from youtube-cookies.json (converted to Netscape format)');
        }
      } catch (e) {
        console.warn('[yt-dlp] Failed to parse youtube-cookies.json:', e.message);
      }
    }
    
    const proc = spawn(ytdlp, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const url = stdout.trim().split('\n')[0];
        console.log('[yt-dlp] Successfully got stream URL');
        resolve({ 
          url, 
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.youtube.com/'
          }
        });
      } else {
        console.warn(`[yt-dlp] Failed: ${stderr.trim() || 'Unknown error'}`);
        resolve(null);
      }
    });
    
    proc.on('error', (err) => {
      console.warn(`[yt-dlp] Process error: ${err.message}`);
      resolve(null);
    });
    
    // Timeout after 15 seconds
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      console.warn('[yt-dlp] Timed out after 15 seconds');
      resolve(null);
    }, 15000);
    
    // Clear timeout when process finishes normally
    proc.on('close', () => clearTimeout(timeout));
  });
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
    
    return new Song(songData, options);
  }

  async getStreamURL(song) {
    const yt = await getInnertube();
    const videoId = extractVideoId(song.url) || song.id;
    
    // Try multiple InnerTube clients
    // Include IOS as fallback since it often works when others fail
    const clientsToTry = [
      'IOS',                     // iOS app - often most reliable
      'WEB_EMBEDDED',            // Embedded web player
      'TVHTML5_SIMPLY_EMBEDDED_PLAYER', // TV embedded
      'TV',                      // TV client
      'ANDROID',                 // Android app - fallback
    ];
    
    let lastError = null;
    let lastUrl = null;
    let lastClient = null;
    
    for (const client of clientsToTry) {
      try {
        console.log(`[YouTube.js] Trying ${client} client for ${videoId}...`);
        const info = await yt.getInfo(videoId, { client });
        const streamingData = info.streaming_data;
        
        if (!streamingData) {
          console.warn(`[YouTube.js] ${client} client returned no streaming data`);
          continue;
        }
        
        const format = getBestAudioFormat(streamingData);
        if (!format) {
          console.warn(`[YouTube.js] ${client} client returned no suitable audio format`);
          continue;
        }
        
        // Try to get the URL - format may already have a direct URL or need deciphering
        let url;
        
        // First check if format already has a direct URL
        if (format.url) {
          url = format.url;
          console.log(`[YouTube.js] ${client} client provided direct URL`);
        } 
        // If not, try to decipher it using the signature_cipher
        else if (format.signature_cipher || format.cipher) {
          try {
            // decipher() is now async in newer versions of YouTube.js
            url = await format.decipher(yt.session.player);
            console.log(`[YouTube.js] ${client} client URL deciphered successfully`);
          } catch (err) {
            console.warn(`[YouTube.js] ${client} decipher failed:`, err.message);
            // Try without await for older versions
            try {
              url = format.decipher(yt.session.player);
              console.log(`[YouTube.js] ${client} client URL deciphered (sync)`);
            } catch (syncErr) {
              console.warn(`[YouTube.js] ${client} sync decipher also failed:`, syncErr.message);
              continue;
            }
          }
        }
        
        if (url) {
          // Verify the URL works before returning
          const clientConfig = CLIENT_CONFIGS[client] || {};
          const headers = clientConfig.headers || {};
          
          console.log(`[YouTube.js] Verifying ${client} URL...`);
          const isValid = await verifyStreamURL(url, headers);
          
          if (isValid) {
            console.log(`[YouTube.js] ${client} URL verified successfully`);
            
            // Store the client used so we know which headers FFmpeg needs
            // This info can be used by DisTube if it supports custom headers
            song._youtubeClient = client;
            song._streamHeaders = headers;
            
            return url;
          } else {
            console.warn(`[YouTube.js] ${client} URL verification failed (403/blocked)`);
            lastUrl = url;
            lastClient = client;
            continue;
          }
        }
      } catch (err) {
        console.warn(`[YouTube.js] ${client} client failed:`, err.message);
        lastError = err;
        continue;
      }
    }
    
    // Try yt-dlp as fallback before giving up
    console.log('[YouTube.js] All InnerTube clients failed, trying yt-dlp fallback...');
    const ytdlpResult = await getStreamURLWithYtdlp(videoId);
    if (ytdlpResult) {
      song._youtubeClient = 'yt-dlp';
      song._streamHeaders = ytdlpResult.headers;
      return ytdlpResult.url;
    }
    
    // If we have a URL but it failed verification, return it anyway as a last resort
    // FFmpeg might still work with it in some cases
    if (lastUrl) {
      console.warn(`[YouTube.js] Returning unverified URL from ${lastClient} as last resort`);
      return lastUrl;
    }
    
    throw new Error(`[YouTube.js] All methods failed to get stream URL. Last error: ${lastError?.message || 'Unknown'}. Consider installing yt-dlp: pip install yt-dlp`);
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
