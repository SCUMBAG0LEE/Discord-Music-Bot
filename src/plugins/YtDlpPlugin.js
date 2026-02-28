/**
 * yt-dlp Plugin for DisTube
 * Pure yt-dlp implementation - no youtubei.js dependency
 * 
 * yt-dlp is actively maintained and reliably handles YouTube's anti-bot measures.
 * This plugin provides:
 * - YouTube video/playlist support
 * - Search functionality  
 * - Stream URL extraction with proper headers
 * - Cookie support for age-restricted content
 */

const { ExtractorPlugin, Song, Playlist } = require('distube');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/** @type {string|null} */
let ytdlpPath = undefined; // undefined = not checked, null = not found, string = path

/**
 * Find yt-dlp binary path
 * @returns {Promise<string|null>}
 */
async function findYtdlp() {
  if (ytdlpPath !== undefined) return ytdlpPath;
  
  const possiblePaths = [
    'yt-dlp',                                    // In PATH (Windows/Linux/Mac)
    'yt-dlp.exe',                                // Windows explicit
    '/usr/local/bin/yt-dlp',                     // macOS/Linux system
    '/usr/bin/yt-dlp',                           // Linux package manager
    `${process.env.HOME}/.local/bin/yt-dlp`,     // pip user install (Linux)
    `${process.env.LOCALAPPDATA}\\yt-dlp\\yt-dlp.exe`, // Windows user install
  ];
  
  for (const tryPath of possiblePaths) {
    try {
      const result = await new Promise((resolve) => {
        const proc = spawn(tryPath, ['--version'], { 
          stdio: 'pipe',
          shell: process.platform === 'win32'
        });
        let version = '';
        proc.stdout?.on('data', (d) => { version += d.toString(); });
        proc.on('error', () => resolve(null));
        proc.on('close', (code) => {
          resolve(code === 0 ? version.trim() : null);
        });
      });
      
      if (result) {
        console.log(`[yt-dlp] Found at "${tryPath}" (version ${result})`);
        ytdlpPath = tryPath;
        return ytdlpPath;
      }
    } catch {
      continue;
    }
  }
  
  console.error('[yt-dlp] Not found! Install with: pip install yt-dlp');
  ytdlpPath = null;
  return null;
}

/**
 * Convert JSON cookie array (e.g. from EditThisCookie) to Netscape format
 * @param {string} jsonPath - Path to the JSON cookie file
 * @returns {string} Path to the converted Netscape-format file
 */
function convertJsonCookies(jsonPath) {
  const netscapePath = jsonPath + '.netscape';
  // Only reconvert if JSON is newer than the converted file
  if (fs.existsSync(netscapePath)) {
    const jsonStat = fs.statSync(jsonPath);
    const netscapeStat = fs.statSync(netscapePath);
    if (netscapeStat.mtimeMs >= jsonStat.mtimeMs) {
      return netscapePath;
    }
  }
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies)) return null;
    const lines = ['# Netscape HTTP Cookie File', '# Converted from JSON by Discord Music Bot', ''];
    for (const c of cookies) {
      if (!c.domain || !c.name) continue;
      const domain = c.domain;
      const hostOnly = c.hostOnly ? 'FALSE' : 'TRUE';
      const cookiePath = c.path || '/';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = Math.floor(c.expirationDate || 0);
      const name = c.name;
      const value = c.value || '';
      lines.push(`${domain}\t${hostOnly}\t${cookiePath}\t${secure}\t${expiry}\t${name}\t${value}`);
    }
    fs.writeFileSync(netscapePath, lines.join('\n') + '\n', 'utf-8');
    console.log(`[yt-dlp] Converted JSON cookies → Netscape format: ${netscapePath}`);
    return netscapePath;
  } catch (err) {
    console.error(`[yt-dlp] Failed to convert JSON cookies: ${err.message}`);
    return null;
  }
}

/**
 * Get cookie file path if exists (checks multiple filenames).
 * Supports both Netscape format (.txt) and JSON format (auto-converted).
 * @returns {string|null}
 */
function getCookiePath() {
  const candidates = [
    'youtube-cookies.txt',
    'cookies.txt',
    'youtube-cookies.json',
    'cookies.json',
  ];
  for (const name of candidates) {
    const filePath = path.join(process.cwd(), name);
    if (fs.existsSync(filePath)) {
      // Check if it's JSON by reading the first non-whitespace character
      try {
        const head = fs.readFileSync(filePath, 'utf-8').trimStart();
        if (head.startsWith('[') || head.startsWith('{')) {
          // JSON cookies — convert to Netscape format for yt-dlp
          const converted = convertJsonCookies(filePath);
          if (converted) return converted;
          continue; // conversion failed, try next candidate
        }
      } catch {
        continue;
      }
      // Already Netscape format
      return filePath;
    }
  }
  return null;
}

/**
 * Run yt-dlp command and return JSON output
 * @param {string[]} args - Command arguments
 * @param {number} timeout - Timeout in ms
 * @returns {Promise<object|null>}
 */
async function runYtdlp(args, timeout = 30000) {
  const ytdlp = await findYtdlp();
  if (!ytdlp) {
    throw new Error('yt-dlp not installed. Install with: pip install yt-dlp');
  }

  return new Promise((resolve, reject) => {
    const fullArgs = [
      '--no-warnings',
      '--no-check-certificates',
      '--geo-bypass',
      '--socket-timeout', '15',
      '--extractor-retries', '3',
      ...args
    ];
    
    // Add cookies if available
    const cookiePath = getCookiePath();
    if (cookiePath) {
      fullArgs.unshift('--cookies', cookiePath);
    }

    const proc = spawn(ytdlp, fullArgs, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('yt-dlp timed out'));
    }, timeout);
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve({ raw: stdout.trim() });
        }
      } else {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Check if a string is any kind of URL
 * @param {string} str
 * @returns {boolean}
 */
function isURL(str) {
  return /^https?:\/\//i.test(str);
}

/**
 * Check if URL is a YouTube URL
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeURL(url) {
  if (typeof url !== 'string') return false;
  
  const patterns = [
    /^https?:\/\/(www\.)?youtube\.com\/watch/,
    /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
    /^https?:\/\/(www\.)?youtube\.com\/playlist/,
    /^https?:\/\/youtu\.be\//,
    /^https?:\/\/music\.youtube\.com\/watch/,
    /^https?:\/\/(www\.)?youtube\.com\/embed\//,
    /^https?:\/\/(www\.)?youtube\.com\/v\//
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

/**
 * Check if URL is a SoundCloud URL
 * @param {string} url
 * @returns {boolean}
 */
function isSoundCloudURL(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\/(www\.|m\.)?soundcloud\.com\//i.test(url);
}

/**
 * Check if URL is a Bandcamp URL
 * @param {string} url
 * @returns {boolean}
 */
function isBandcampURL(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\/[a-z0-9-]+\.bandcamp\.com\/(track|album)\//i.test(url);
}

/**
 * Check if URL is a Vimeo URL
 * @param {string} url
 * @returns {boolean}
 */
function isVimeoURL(url) {
  if (typeof url !== 'string') return false;
  return /^https?:\/\/(www\.)?vimeo\.com\/\d+/i.test(url);
}

/**
 * Check if URL is a direct HTTP audio/video stream
 * (not a known platform URL — e.g. .mp3, .ogg, .flac, .wav, .m4a, .aac, .opus, .webm, .mp4, or generic stream)
 * @param {string} url
 * @returns {boolean}
 */
function isDirectHTTPURL(url) {
  if (typeof url !== 'string' || !isURL(url)) return false;
  // Exclude known platforms that have their own handlers
  if (isYouTubeURL(url) || isBandcampURL(url) || isVimeoURL(url)) return false;
  if (/soundcloud\.com|spotify\.com|twitch\.tv/i.test(url)) return false;
  // Accept common audio/video file extensions
  if (/\.(mp3|ogg|opus|flac|wav|m4a|aac|webm|mp4|wma)(\?.*)?$/i.test(url)) return true;
  // Accept common stream content types (M3U/PLS playlists, Icecast, etc.)
  if (/\.(m3u8?|pls)(\?.*)?$/i.test(url)) return true;
  return false;
}

/**
 * Detect the source platform from a URL
 * @param {string} url
 * @returns {string}
 */
function detectSource(url) {
  if (isYouTubeURL(url)) return 'youtube';
  if (isSoundCloudURL(url)) return 'soundcloud';
  if (isBandcampURL(url)) return 'bandcamp';
  if (isVimeoURL(url)) return 'vimeo';
  if (/twitch\.tv/i.test(url)) return 'twitch';
  if (/dailymotion\.com|dai\.ly/i.test(url)) return 'dailymotion';
  if (isDirectHTTPURL(url)) return 'http';
  return 'other';
}

/**
 * Check if URL is a playlist
 * @param {string} url
 * @returns {boolean}
 */
function isPlaylistURL(url) {
  return /[?&]list=([a-zA-Z0-9_-]+)/.test(url) && !url.includes('watch?v=');
}

/**
 * Format duration from seconds to mm:ss or hh:mm:ss
 * @param {number} seconds
 * @returns {string}
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

class YtDlpPlugin extends ExtractorPlugin {
  constructor(options = {}) {
    super();
    this.options = options;
  }

  async init() {
    // Pre-check yt-dlp availability
    const ytdlp = await findYtdlp();
    if (!ytdlp) {
      console.error('[YtDlpPlugin] WARNING: yt-dlp not found! YouTube playback will fail.');
      console.error('[YtDlpPlugin] Install with: pip install yt-dlp');
    }
  }

  validate(url) {
    if (typeof url !== 'string') return false;
    // Accept non-URL strings as search queries (e.g. from Spotify plugin)
    if (!isURL(url)) return true;
    // Let Spotify plugin handle its own URLs
    if (/spotify\.com/i.test(url)) return false;
    // Accept all other URLs — yt-dlp supports 1000+ extractors
    // (YouTube, SoundCloud, Bandcamp, Vimeo, Twitch, Dailymotion, direct HTTP, etc.)
    // SoundCloud is routed through yt-dlp for direct audio URLs (not HLS)
    return true;
  }

  async resolve(url, options) {
    if (isYouTubeURL(url)) {
      if (isPlaylistURL(url)) {
        return this.resolvePlaylist(url, options);
      }
      return this.resolveVideo(url, options);
    }
    // SoundCloud set/playlist URLs → resolve as playlist
    if (isSoundCloudURL(url) && /\/sets\//i.test(url)) {
      return this.resolveGenericPlaylist(url, 'soundcloud', options);
    }
    // Any other URL — resolve via yt-dlp generically
    // (SoundCloud, Bandcamp, Vimeo, Twitch, Dailymotion, direct HTTP, etc.)
    if (isURL(url)) {
      return this.resolveGeneric(url, options);
    }
    // Non-URL string = search query (from Spotify plugin etc.)
    return this.resolveSearch(url, options);
  }

  /**
   * Resolve any URL that yt-dlp supports (Bandcamp, Vimeo, direct HTTP, etc.)
   */
  async resolveGeneric(url, options) {
    const source = detectSource(url);
    console.log(`[yt-dlp] Resolving ${source} URL: ${url}`);

    // For Bandcamp album URLs, resolve as playlist
    if (isBandcampURL(url) && /\/album\//i.test(url)) {
      return this.resolveGenericPlaylist(url, source, options);
    }

    const info = await runYtdlp([
      '-J',
      '--no-playlist',
      url
    ], 30000);

    if (!info || (!info.id && !info.title && !info.webpage_url)) {
      throw new Error(`Failed to resolve ${source} URL`);
    }

    return this.createGenericSong(info, source, url, options);
  }

  /**
   * Resolve a generic playlist (e.g. Bandcamp album)
   */
  async resolveGenericPlaylist(url, source, options) {
    console.log(`[yt-dlp] Resolving ${source} playlist: ${url}`);

    const info = await runYtdlp([
      '-J',
      '--flat-playlist',
      '--playlist-end', '100',
      url
    ], 60000);

    if (!info?.entries || info.entries.length === 0) {
      throw new Error(`${source} playlist not found or empty`);
    }

    const songs = info.entries
      .filter(entry => entry.id || entry.url || entry.webpage_url)
      .map(entry => this.createGenericSong(entry, source, entry.webpage_url || entry.url || url, options));

    if (songs.length === 0) {
      throw new Error(`No playable tracks found in ${source} playlist`);
    }

    return new Playlist({
      source,
      songs,
      name: info.title || `${source} Playlist`,
      url,
      thumbnail: info.thumbnail || songs[0]?.thumbnail
    }, options);
  }

  async resolveSearch(query, options) {
    console.log(`[yt-dlp] Searching YouTube for: ${query}`);
    
    const info = await runYtdlp([
      '-J',
      '--flat-playlist',
      '--playlist-end', '1',
      `ytsearch1:${query}`
    ], 15000);
    
    if (!info?.entries || info.entries.length === 0) {
      throw new Error(`No YouTube results found for: ${query}`);
    }
    
    const entry = info.entries[0];
    return this.createSong({
      id: entry.id,
      title: entry.title || query,
      duration: entry.duration || 0,
      thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
      channel: entry.channel || entry.uploader || 'Unknown',
      channel_url: entry.channel_url || entry.uploader_url || null,
      view_count: entry.view_count || 0,
      webpage_url: entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`
    }, options, false);
  }

  async resolveVideo(url, options) {
    console.log(`[yt-dlp] Resolving video: ${url}`);
    
    const info = await runYtdlp([
      '-J',                    // JSON output
      '--no-playlist',         // Single video only
      url
    ]);
    
    if (!info || !info.id) {
      throw new Error('Failed to get video info');
    }
    
    return this.createSong(info, options);
  }

  async resolvePlaylist(url, options) {
    console.log(`[yt-dlp] Resolving playlist: ${url}`);
    
    const info = await runYtdlp([
      '-J',                    // JSON output
      '--flat-playlist',       // Don't download, just get info
      '--playlist-end', '100', // Limit to 100 tracks
      url
    ], 60000); // Longer timeout for playlists
    
    if (!info || !info.entries || info.entries.length === 0) {
      throw new Error('Playlist not found or empty');
    }
    
    const songs = [];
    for (const entry of info.entries) {
      if (entry.id) {
        songs.push(this.createSong({
          id: entry.id,
          title: entry.title || 'Unknown',
          duration: entry.duration || 0,
          thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
          channel: entry.channel || entry.uploader || 'Unknown',
          channel_url: entry.channel_url || entry.uploader_url || null,
          view_count: entry.view_count || 0,
          webpage_url: entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`
        }, options, false));
      }
    }
    
    if (songs.length === 0) {
      throw new Error('No playable videos found in playlist');
    }
    
    return new Playlist({
      source: 'youtube',
      songs,
      name: info.title || 'YouTube Playlist',
      url: url,
      thumbnail: info.thumbnail || songs[0]?.thumbnail
    }, options);
  }

  createSong(info, options, includeStreamUrl = true) {
    const songData = {
      plugin: this,
      source: 'youtube',
      playFromSource: true,
      id: info.id,
      name: info.title || 'Unknown',
      url: info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
      thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
      duration: info.duration || 0,
      formattedDuration: formatDuration(info.duration),
      views: info.view_count || 0,
      likes: info.like_count || 0,
      isLive: info.is_live || false,
      uploader: {
        name: info.channel || info.uploader || 'Unknown',
        url: info.channel_url || info.uploader_url || null
      }
    };
    
    return new Song(songData, options);
  }

  /**
   * Create a Song object for non-YouTube sources (Bandcamp, Vimeo, HTTP, etc.)
   */
  createGenericSong(info, source, originalUrl, options) {
    const songData = {
      plugin: this,
      source,
      playFromSource: true,
      id: info.id || info.display_id || originalUrl,
      name: info.title || info.fulltitle || 'Unknown',
      url: info.webpage_url || originalUrl,
      thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null,
      duration: info.duration || 0,
      formattedDuration: formatDuration(info.duration),
      views: info.view_count || 0,
      likes: info.like_count || 0,
      isLive: info.is_live || false,
      uploader: {
        name: info.artist || info.creator || info.channel || info.uploader || 'Unknown',
        url: info.artist_url || info.channel_url || info.uploader_url || null
      }
    };

    return new Song(songData, options);
  }

  async getStreamURL(song) {
    const source = song.source || 'youtube';

    // For non-YouTube sources, resolve the stream URL via yt-dlp using the page URL
    if (source !== 'youtube') {
      const target = song.url || song.id;
      console.log(`[yt-dlp] Getting stream URL for ${source}: ${target}`);

      // Direct HTTP URLs can often be streamed as-is
      if (isDirectHTTPURL(target)) {
        console.log('[yt-dlp] Direct HTTP URL — using as-is');
        return target;
      }

      const info = await runYtdlp([
        '-f', 'bestaudio/best',
        '-g',
        '--no-playlist',
        target
      ], 20000);

      if (info?.raw) {
        const url = info.raw.split('\n')[0];
        console.log(`[yt-dlp] Got ${source} stream URL successfully`);
        return url;
      }
      throw new Error(`Failed to get stream URL for ${source}`);
    }

    // YouTube — existing logic with retries
    const videoId = song.id;
    console.log(`[yt-dlp] Getting stream URL for: ${videoId}`);
    
    const maxRetries = 2;
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const info = await runYtdlp([
          '-f', 'bestaudio',
          '-S', '+aext:webm,abr',   // Prefer Opus/WebM, then sort by highest audio bitrate
          '-g',  // Get URL only
          '--no-playlist',
          `https://www.youtube.com/watch?v=${videoId}`
        ], 20000);
        
        if (info?.raw) {
          const url = info.raw.split('\n')[0];
          console.log('[yt-dlp] Got stream URL successfully');
          return url;
        }
        
        throw new Error('No stream URL returned');
      } catch (error) {
        lastError = error;
        console.error(`[yt-dlp] Stream URL attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        if (attempt < maxRetries) {
          // Wait before retrying (increases with each attempt)
          await new Promise(r => setTimeout(r, attempt * 2000));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Search for a song on YouTube (used by DisTube to resolve Spotify/info-only tracks)
   * @param {string} query - Search query (e.g. "song name artist")
   * @param {object} options - Resolve options from DisTube
   * @returns {Promise<Song|null>}
   */
  async searchSong(query, options) {
    console.log(`[yt-dlp] searchSong: ${query}`);
    
    try {
      const info = await runYtdlp([
        '-J',
        '--flat-playlist',
        '--playlist-end', '1',
        `ytsearch1:${query}`
      ], 15000);
      
      if (!info?.entries || info.entries.length === 0) {
        return null;
      }
      
      const entry = info.entries[0];
      return this.createSong({
        id: entry.id,
        title: entry.title || query,
        duration: entry.duration || 0,
        thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
        channel: entry.channel || entry.uploader || 'Unknown',
        channel_url: entry.channel_url || entry.uploader_url || null,
        view_count: entry.view_count || 0,
        webpage_url: entry.webpage_url || entry.url || `https://www.youtube.com/watch?v=${entry.id}`
      }, options, false);
    } catch (error) {
      console.error(`[yt-dlp] searchSong failed: ${error.message}`);
      return null;
    }
  }

  async getRelatedSongs(song) {
    // yt-dlp doesn't expose YouTube's related videos directly,
    // so we search for similar content based on the current song.
    try {
      const query = `${song.name} ${song.uploader?.name || ''}`.trim();
      console.log(`[yt-dlp] Fetching related songs for: ${query}`);
      const results = await this.search(query, 5);
      // Filter out the current song
      const filtered = results.filter(r => r.id !== song.id);
      if (filtered.length === 0) return [];
      // Return as Song objects
      return filtered.slice(0, 3).map(r => this.createSong({
        id: r.id,
        title: r.title,
        duration: r.duration,
        thumbnail: r.thumbnail,
        channel: r.channel,
        view_count: parseInt(r.views) || 0,
        webpage_url: r.url
      }, {}, false));
    } catch (error) {
      console.error(`[yt-dlp] Failed to get related songs: ${error.message}`);
      return [];
    }
  }

  /**
   * Search YouTube for videos
   * @param {string} query - Search query
   * @param {number} limit - Max results (default 10)
   * @returns {Promise<Array>}
   */
  async search(query, limit = 10) {
    console.log(`[yt-dlp] Searching YouTube: ${query}`);
    
    try {
      const info = await runYtdlp([
        '-J',
        '--flat-playlist',
        '--playlist-end', String(limit),
        `ytsearch${limit}:${query}`
      ], 15000);
      
      if (!info?.entries) {
        return [];
      }
      
      return info.entries.map(entry => ({
        id: entry.id,
        title: entry.title || 'Unknown',
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        duration: entry.duration || 0,
        durationFormatted: formatDuration(entry.duration),
        thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/hqdefault.jpg`,
        channel: entry.channel || entry.uploader || 'Unknown',
        views: entry.view_count ? `${(entry.view_count / 1000).toFixed(0)}K views` : '0 views',
        source: 'youtube'
      }));
    } catch (error) {
      console.error(`[yt-dlp] YouTube search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search SoundCloud for tracks via yt-dlp
   * @param {string} query - Search query
   * @param {number} limit - Max results (default 10)
   * @returns {Promise<Array>}
   */
  async searchSoundCloud(query, limit = 10) {
    console.log(`[yt-dlp] Searching SoundCloud: ${query}`);

    try {
      const info = await runYtdlp([
        '-J',
        '--flat-playlist',
        '--playlist-end', String(limit),
        `scsearch${limit}:${query}`
      ], 15000);

      if (!info?.entries) {
        return [];
      }

      return info.entries.map(entry => ({
        id: entry.id || entry.display_id,
        title: entry.title || 'Unknown',
        url: entry.webpage_url || entry.url,
        duration: entry.duration || 0,
        durationFormatted: formatDuration(entry.duration),
        thumbnail: entry.thumbnail || entry.thumbnails?.[0]?.url || null,
        channel: entry.uploader || entry.artist || 'Unknown',
        views: entry.view_count ? `${(entry.view_count / 1000).toFixed(0)}K views` : '0 views',
        source: 'soundcloud'
      }));
    } catch (error) {
      console.error(`[yt-dlp] SoundCloud search failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Search and return as DisTube songs (for searchSongs)
   */
  async searchSongs(query, options, limit = 10) {
    const results = await this.search(query, limit);
    return results.map(r => this.createSong({
      id: r.id,
      title: r.title,
      duration: r.duration,
      thumbnail: r.thumbnail,
      channel: r.channel,
      view_count: parseInt(r.views) || 0,
      webpage_url: r.url
    }, options, false));
  }
}

module.exports = { YtDlpPlugin, findYtdlp, isYouTubeURL, isSoundCloudURL, isBandcampURL, isVimeoURL, isDirectHTTPURL };
