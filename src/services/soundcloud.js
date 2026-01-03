const play = require('play-dl');

/**
 * Check if URL is a SoundCloud URL
 * @param {string} url
 * @returns {boolean}
 */
function isSoundCloudUrl(url) {
  return play.so_validate(url) !== false;
}

/**
 * Get the type of SoundCloud resource
 * @param {string} url
 * @returns {'track'|'playlist'|null}
 */
function getResourceType(url) {
  const type = play.so_validate(url);
  if (type === 'track' || type === 'playlist') {
    return type;
  }
  return null;
}

/**
 * Get a single track from SoundCloud
 * @param {string} url - SoundCloud track URL
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getTrack(url, requesterId) {
  try {
    const info = await play.soundcloud(url);
    
    if (info.type !== 'track') {
      return { song: null, error: 'Invalid SoundCloud track URL' };
    }
    
    const song = {
      title: info.name,
      url: info.url,
      duration: Math.floor(info.durationInMs / 1000) || 0,
      requester: requesterId,
      source: 'soundcloud',
      sourceUrl: info.permalink,
      thumbnail: info.thumbnail || null,
      artist: info.user?.name || 'Unknown'
    };
    
    return { song, error: null };
  } catch (err) {
    console.error('SoundCloud getTrack error:', err.message);
    return { song: null, error: 'Error fetching SoundCloud track.' };
  }
}

/**
 * Get playlist tracks from SoundCloud
 * @param {string} url - SoundCloud playlist URL
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<{songs: Object[], name: string|null, error: string|null}>}
 */
async function getPlaylist(url, requesterId) {
  try {
    const playlist = await play.soundcloud(url);
    
    if (playlist.type !== 'playlist') {
      return { songs: [], name: null, error: 'Invalid SoundCloud playlist URL' };
    }
    
    const tracks = await playlist.all_tracks();
    
    const songs = tracks.map(track => ({
      title: track.name,
      url: track.url,
      duration: Math.floor(track.durationInMs / 1000) || 0,
      requester: requesterId,
      source: 'soundcloud',
      sourceUrl: track.permalink,
      thumbnail: track.thumbnail || null,
      artist: track.user?.name || 'Unknown'
    }));
    
    if (songs.length === 0) {
      return { songs: [], name: playlist.name, error: 'No playable tracks found in this SoundCloud playlist.' };
    }
    
    return { songs, name: playlist.name, error: null };
  } catch (err) {
    console.error('SoundCloud getPlaylist error:', err.message);
    return { songs: [], name: null, error: 'Error fetching SoundCloud playlist.' };
  }
}

/**
 * Search SoundCloud for tracks
 * @param {string} query - Search query
 * @param {number} [maxResults=5] - Maximum number of results
 * @returns {Promise<Object[]>}
 */
async function search(query, maxResults = 5) {
  try {
    const results = await play.search(query, { source: { soundcloud: 'tracks' }, limit: maxResults });
    return results.map(track => ({
      title: track.name,
      url: track.url,
      duration: Math.floor(track.durationInMs / 1000) || 0,
      author: track.user?.name || 'Unknown',
      thumbnail: track.thumbnail || null
    }));
  } catch (err) {
    console.error('SoundCloud search error:', err.message);
    return [];
  }
}

module.exports = {
  isSoundCloudUrl,
  getResourceType,
  getTrack,
  getPlaylist,
  search
};
