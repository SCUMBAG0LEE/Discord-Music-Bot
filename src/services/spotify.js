const SpotifyWebApi = require('spotify-web-api-node');
const youtubeService = require('./youtube');

// Initialize Spotify client
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

let tokenRefreshTimeout = null;

/**
 * Refresh Spotify access token using Client Credentials Flow
 */
async function refreshToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('✓ Spotify token refreshed');
    
    // Clear existing timeout
    if (tokenRefreshTimeout) {
      clearTimeout(tokenRefreshTimeout);
    }
    
    // Refresh token a minute before expiration
    tokenRefreshTimeout = setTimeout(refreshToken, (data.body['expires_in'] - 60) * 1000);
  } catch (err) {
    console.error('✗ Failed to refresh Spotify token:', err.message);
    // Retry after 30 seconds on failure
    tokenRefreshTimeout = setTimeout(refreshToken, 30000);
  }
}

/**
 * Initialize Spotify service
 */
async function initialize() {
  await refreshToken();
}

/**
 * Extract Spotify ID from URL for a given type
 * @param {string} url - Spotify URL
 * @param {'track'|'playlist'|'album'} type - Resource type
 * @returns {string|null}
 */
function extractId(url, type) {
  const regex = new RegExp(`/${type}/([a-zA-Z0-9]+)`);
  const match = url.match(regex);
  return match ? match[1] : null;
}

/**
 * Check if URL is a Spotify URL
 * @param {string} url
 * @returns {boolean}
 */
function isSpotifyUrl(url) {
  return url.includes('open.spotify.com');
}

/**
 * Get the type of Spotify resource from URL
 * @param {string} url
 * @returns {'track'|'playlist'|'album'|null}
 */
function getResourceType(url) {
  if (url.includes('/track/')) return 'track';
  if (url.includes('/playlist/')) return 'playlist';
  if (url.includes('/album/')) return 'album';
  return null;
}

/**
 * Convert Spotify track to a playable song object
 * @param {Object} track - Spotify track object
 * @param {string} requesterId - Discord user ID
 * @returns {Promise<Object|null>}
 */
async function trackToSong(track, requesterId) {
  const song = await youtubeService.searchFromSpotifyTrack(track, requesterId);
  if (song) {
    song.source = 'spotify';
    song.sourceUrl = track.external_urls?.spotify || '';
  }
  return song;
}

/**
 * Get a single track
 * @param {string} url - Spotify track URL
 * @param {string} requesterId
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getTrack(url, requesterId) {
  const trackId = extractId(url, 'track');
  if (!trackId) {
    return { song: null, error: 'Invalid Spotify track URL' };
  }
  
  try {
    const data = await spotifyApi.getTrack(trackId);
    const song = await trackToSong(data.body, requesterId);
    
    if (!song) {
      return { song: null, error: 'Could not find a matching YouTube video for this track.' };
    }
    
    return { song, error: null };
  } catch (err) {
    console.error('Spotify getTrack error:', err.message);
    return { song: null, error: 'Error fetching Spotify track details.' };
  }
}

/**
 * Get playlist tracks
 * @param {string} url - Spotify playlist URL
 * @param {string} requesterId
 * @returns {Promise<{songs: Object[], name: string|null, error: string|null}>}
 */
async function getPlaylist(url, requesterId) {
  const playlistId = extractId(url, 'playlist');
  if (!playlistId) {
    return { songs: [], name: null, error: 'Invalid Spotify playlist URL' };
  }
  
  try {
    const data = await spotifyApi.getPlaylist(playlistId);
    const playlistInfo = data.body;
    const tracks = playlistInfo.tracks.items.filter(item => item.track);
    
    const songs = [];
    for (const item of tracks) {
      const song = await trackToSong(item.track, requesterId);
      if (song) songs.push(song);
    }
    
    if (songs.length === 0) {
      return { songs: [], name: playlistInfo.name, error: 'No playable tracks found in this Spotify playlist.' };
    }
    
    return { songs, name: playlistInfo.name, error: null };
  } catch (err) {
    console.error('Spotify getPlaylist error:', err.message);
    return { songs: [], name: null, error: 'Error fetching Spotify playlist details.' };
  }
}

/**
 * Get album tracks
 * @param {string} url - Spotify album URL
 * @param {string} requesterId
 * @returns {Promise<{songs: Object[], name: string|null, error: string|null}>}
 */
async function getAlbum(url, requesterId) {
  const albumId = extractId(url, 'album');
  if (!albumId) {
    return { songs: [], name: null, error: 'Invalid Spotify album URL' };
  }
  
  try {
    const data = await spotifyApi.getAlbum(albumId);
    const albumInfo = data.body;
    const tracks = albumInfo.tracks.items;
    
    const songs = [];
    for (const track of tracks) {
      const song = await trackToSong(track, requesterId);
      if (song) songs.push(song);
    }
    
    if (songs.length === 0) {
      return { songs: [], name: albumInfo.name, error: 'No playable tracks found in this Spotify album.' };
    }
    
    return { songs, name: albumInfo.name, error: null };
  } catch (err) {
    console.error('Spotify getAlbum error:', err.message);
    return { songs: [], name: null, error: 'Error fetching Spotify album details.' };
  }
}

module.exports = {
  initialize,
  isSpotifyUrl,
  getResourceType,
  getTrack,
  getPlaylist,
  getAlbum
};
