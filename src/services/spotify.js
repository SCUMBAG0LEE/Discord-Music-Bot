const play = require('play-dl');
const youtubeService = require('./youtube');

/**
 * Initialize Spotify with credentials
 * Called once at startup
 */
async function initialize() {
  try {
    // Check if Spotify credentials are configured
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
      console.log('⚠ Spotify credentials not configured - Spotify support disabled');
      return;
    }

    // Set Spotify token using play-dl
    await play.setToken({
      spotify: {
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
        refresh_token: process.env.SPOTIFY_REFRESH_TOKEN || undefined,
        market: process.env.SPOTIFY_MARKET || 'US'
      }
    });
    
    console.log('✓ Spotify initialized');
  } catch (err) {
    console.error('✗ Failed to initialize Spotify:', err.message);
  }
}

/**
 * Check if URL is a Spotify URL
 * @param {string} url
 * @returns {boolean}
 */
function isSpotifyUrl(url) {
  return play.sp_validate(url) !== false;
}

/**
 * Get the type of Spotify resource from URL
 * @param {string} url
 * @returns {'track'|'playlist'|'album'|null}
 */
function getResourceType(url) {
  const type = play.sp_validate(url);
  if (type === 'track' || type === 'playlist' || type === 'album') {
    return type;
  }
  return null;
}

/**
 * Get a single track
 * @param {string} url - Spotify track URL
 * @param {string} requesterId
 * @returns {Promise<{song: Object|null, error: string|null}>}
 */
async function getTrack(url, requesterId) {
  try {
    const spotifyData = await play.spotify(url);
    
    if (spotifyData.type !== 'track') {
      return { song: null, error: 'Invalid Spotify track URL' };
    }
    
    // Search YouTube for this track
    const song = await youtubeService.searchFromSpotifyTrack(spotifyData, requesterId);
    
    if (!song) {
      return { song: null, error: 'Could not find a matching YouTube video for this track.' };
    }
    
    // Add Spotify metadata
    song.source = 'spotify';
    song.sourceUrl = spotifyData.url || url;
    song.spotifyTitle = spotifyData.name;
    song.spotifyArtists = spotifyData.artists?.map(a => a.name) || [];
    
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
  try {
    const spotifyData = await play.spotify(url);
    
    if (spotifyData.type !== 'playlist') {
      return { songs: [], name: null, error: 'Invalid Spotify playlist URL' };
    }
    
    // Get all tracks from playlist
    const tracks = await spotifyData.all_tracks();
    
    const songs = [];
    for (const track of tracks) {
      const song = await youtubeService.searchFromSpotifyTrack(track, requesterId);
      if (song) {
        song.source = 'spotify';
        song.sourceUrl = track.url || url;
        song.spotifyTitle = track.name;
        song.spotifyArtists = track.artists?.map(a => a.name) || [];
        songs.push(song);
      }
    }
    
    if (songs.length === 0) {
      return { songs: [], name: spotifyData.name, error: 'No playable tracks found in this Spotify playlist.' };
    }
    
    return { songs, name: spotifyData.name, error: null };
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
  try {
    const spotifyData = await play.spotify(url);
    
    if (spotifyData.type !== 'album') {
      return { songs: [], name: null, error: 'Invalid Spotify album URL' };
    }
    
    // Get all tracks from album
    const tracks = await spotifyData.all_tracks();
    
    const songs = [];
    for (const track of tracks) {
      const song = await youtubeService.searchFromSpotifyTrack(track, requesterId);
      if (song) {
        song.source = 'spotify';
        song.sourceUrl = track.url || url;
        song.spotifyTitle = track.name;
        song.spotifyArtists = track.artists?.map(a => a.name) || [];
        songs.push(song);
      }
    }
    
    if (songs.length === 0) {
      return { songs: [], name: spotifyData.name, error: 'No playable tracks found in this Spotify album.' };
    }
    
    return { songs, name: spotifyData.name, error: null };
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
