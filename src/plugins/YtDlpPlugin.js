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

const { PlayableExtractorPlugin, Song, Playlist } = require('distube');
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
 * Get cookie file path if exists
 * @returns {string|null}
 */
function getCookiePath() {
  const txtPath = path.join(process.cwd(), 'youtube-cookies.txt');
  if (fs.existsSync(txtPath)) {
    return txtPath;
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
      '--prefer-free-formats',
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

class YtDlpPlugin extends PlayableExtractorPlugin {
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
    return isYouTubeURL(url);
  }

  async resolve(url, options) {
    if (isPlaylistURL(url)) {
      return this.resolvePlaylist(url, options);
    }
    return this.resolveVideo(url, options);
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

  async getStreamURL(song) {
    const videoId = song.id;
    console.log(`[yt-dlp] Getting stream URL for: ${videoId}`);
    
    try {
      const info = await runYtdlp([
        '-f', 'bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best',
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
      console.error(`[yt-dlp] Failed to get stream URL: ${error.message}`);
      throw error;
    }
  }

  async getRelatedSongs(song) {
    // yt-dlp doesn't easily provide related videos
    // Return empty array - autoplay will use DisTube's fallback
    return [];
  }

  /**
   * Search YouTube for videos
   * @param {string} query - Search query
   * @param {number} limit - Max results (default 10)
   * @returns {Promise<Array>}
   */
  async search(query, limit = 10) {
    console.log(`[yt-dlp] Searching: ${query}`);
    
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
        views: entry.view_count ? `${(entry.view_count / 1000).toFixed(0)}K views` : '0 views'
      }));
    } catch (error) {
      console.error(`[yt-dlp] Search failed: ${error.message}`);
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

module.exports = { YtDlpPlugin, findYtdlp, isYouTubeURL };
