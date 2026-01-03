const play = require('play-dl');

// Common radio stations (can be extended)
const PRESET_STATIONS = {
  'lofi': 'https://streams.ilovemusic.de/iloveradio17.mp3',
  'jazz': 'https://streaming.radio.co/s774887f7b/listen',
  'classical': 'https://live.musopen.org:8085/streamvbr0',
  'chillhop': 'https://streams.fluxfm.de/Chillhop/mp3-320',
  'synthwave': 'https://radio.plaza.one/mp3'
};

/**
 * Check if URL is a valid stream/radio URL
 * @param {string} url
 * @returns {boolean}
 */
function isStreamUrl(url) {
  // Check for common stream extensions and protocols
  const streamPatterns = [
    /^https?:\/\/.+\.(mp3|ogg|aac|m3u|m3u8|pls)(\?.*)?$/i,
    /^https?:\/\/.+\/stream/i,
    /^https?:\/\/.+\/listen/i,
    /icecast/i,
    /shoutcast/i,
    /radio/i
  ];
  
  return streamPatterns.some(pattern => pattern.test(url));
}

/**
 * Check if URL is a direct audio URL
 * @param {string} url
 * @returns {boolean}
 */
function isDirectUrl(url) {
  return /^https?:\/\/.+\.(mp3|ogg|wav|flac|m4a|aac|webm)(\?.*)?$/i.test(url);
}

/**
 * Get preset station URL by name
 * @param {string} name
 * @returns {string|null}
 */
function getPresetStation(name) {
  const key = name.toLowerCase();
  return PRESET_STATIONS[key] || null;
}

/**
 * Get list of available preset stations
 * @returns {string[]}
 */
function getPresetList() {
  return Object.keys(PRESET_STATIONS);
}

/**
 * Create song object from stream URL
 * @param {string} url - Stream URL
 * @param {string} requesterId - Discord user ID
 * @param {string} [title] - Optional custom title
 * @returns {{song: Object, error: null}}
 */
function createStreamSong(url, requesterId, title = null) {
  // Extract title from URL if not provided
  const extractedTitle = title || extractTitleFromUrl(url);
  
  return {
    song: {
      title: extractedTitle,
      url: url,
      duration: 0, // Streams have no duration
      requester: requesterId,
      source: 'stream',
      sourceUrl: url,
      isStream: true,
      thumbnail: null
    },
    error: null
  };
}

/**
 * Extract a readable title from stream URL
 * @param {string} url
 * @returns {string}
 */
function extractTitleFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    const pathname = urlObj.pathname.split('/').filter(Boolean).pop() || '';
    
    // Clean up the pathname
    const cleanPath = pathname
      .replace(/\.(mp3|ogg|aac|m3u|pls)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
    
    if (cleanPath) {
      return `${cleanPath} (${hostname})`;
    }
    return `Stream: ${hostname}`;
  } catch {
    return 'Unknown Stream';
  }
}

/**
 * Validate and get stream info
 * @param {string} url - Stream URL
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getStream(url, requesterId) {
  try {
    // Check if it's a preset
    const preset = getPresetStation(url);
    if (preset) {
      return createStreamSong(preset, requesterId, `Radio: ${url.charAt(0).toUpperCase() + url.slice(1)}`);
    }
    
    // Validate URL format
    if (!isStreamUrl(url) && !isDirectUrl(url)) {
      return { song: null, error: 'Invalid stream URL format.' };
    }
    
    return createStreamSong(url, requesterId);
  } catch (err) {
    console.error('Stream getStream error:', err.message);
    return { song: null, error: 'Error processing stream URL.' };
  }
}

module.exports = {
  isStreamUrl,
  isDirectUrl,
  getPresetStation,
  getPresetList,
  getStream,
  createStreamSong,
  PRESET_STATIONS
};
