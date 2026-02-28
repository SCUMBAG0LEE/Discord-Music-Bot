const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

// Directory for storing playlists (use __dirname for reliability — process.cwd()
// may differ when launched via PM2, systemd, or another working directory)
const PLAYLISTS_DIR = path.join(__dirname, '../../data/playlists');

/**
 * Ensure playlists directory exists
 */
async function ensureDirectory() {
  try {
    await fs.mkdir(PLAYLISTS_DIR, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      logger.error('Playlists', 'Error creating playlists directory', err);
    }
  }
}

/**
 * Get playlist file path for a user
 * @param {string} userId
 * @param {string} playlistName
 * @returns {string}
 */
function getPlaylistPath(userId, playlistName) {
  const safeName = playlistName.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return path.join(PLAYLISTS_DIR, `${userId}_${safeName}.json`);
}

/**
 * Get playlist synchronously (for quick checks)
 * @param {string} userId - Discord user ID  
 * @param {string} name - Playlist name
 * @returns {Object|null}
 */
function getPlaylist(userId, name) {
  try {
    const filePath = getPlaylistPath(userId, name);
    if (!fsSync.existsSync(filePath)) return null;
    const data = fsSync.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

/**
 * Save a playlist
 * @param {string} userId - Discord user ID
 * @param {string} name - Playlist name
 * @param {Object[]} songs - Array of song objects
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function savePlaylist(userId, name, songs, options = {}) {
  await ensureDirectory();
  
  if (!name || name.length > 32) {
    return { success: false, error: 'Playlist name must be 1-32 characters.' };
  }
  
  if (songs.length === 0) {
    return { success: false, error: 'Cannot save empty playlist.' };
  }
  
  if (songs.length > 200) {
    return { success: false, error: 'Playlist cannot exceed 200 songs.' };
  }
  
  // Store only essential song data
  const playlistData = {
    name,
    userId,
    createdAt: options?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    songs: songs.map(song => ({
      title: song.title,
      url: song.url,
      duration: song.duration || 0,
      source: song.source || 'youtube',
      sourceUrl: song.sourceUrl || song.url
    }))
  };
  
  try {
    const filePath = getPlaylistPath(userId, name);
    await fs.writeFile(filePath, JSON.stringify(playlistData, null, 2));
    return { success: true, error: null };
  } catch (err) {
    logger.error('Playlists', `Error saving playlist: ${name}`, err);
    return { success: false, error: 'Failed to save playlist.' };
  }
}

/**
 * Load a playlist
 * @param {string} userId - Discord user ID
 * @param {string} name - Playlist name
 * @returns {Promise<{playlist: Object|null, error: string|null}>}
 */
async function loadPlaylist(userId, name) {
  try {
    const filePath = getPlaylistPath(userId, name);
    const data = await fs.readFile(filePath, 'utf-8');
    const playlist = JSON.parse(data);
    return { playlist, error: null };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { playlist: null, error: `Playlist "${name}" not found.` };
    }
    logger.error('Playlists', `Error loading playlist: ${name}`, err);
    return { playlist: null, error: 'Failed to load playlist.' };
  }
}

/**
 * Delete a playlist
 * @param {string} userId - Discord user ID
 * @param {string} name - Playlist name
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function deletePlaylist(userId, name) {
  try {
    const filePath = getPlaylistPath(userId, name);
    await fs.unlink(filePath);
    return { success: true, error: null };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { success: false, error: `Playlist "${name}" not found.` };
    }
    logger.error('Playlists', `Error deleting playlist: ${name}`, err);
    return { success: false, error: 'Failed to delete playlist.' };
  }
}

/**
 * List all playlists for a user
 * @param {string} userId - Discord user ID
 * @returns {Promise<{playlists: Object[], error: string|null}>}
 */
async function listPlaylists(userId) {
  await ensureDirectory();
  
  try {
    const files = await fs.readdir(PLAYLISTS_DIR);
    const userFiles = files.filter(f => f.startsWith(`${userId}_`) && f.endsWith('.json'));
    
    const playlists = [];
    for (const file of userFiles) {
      try {
        const data = await fs.readFile(path.join(PLAYLISTS_DIR, file), 'utf-8');
        const playlist = JSON.parse(data);
        playlists.push({
          name: playlist.name,
          songCount: playlist.songs.length,
          createdAt: playlist.createdAt
        });
      } catch {
        // Skip corrupted files
      }
    }
    
    return { playlists, error: null };
  } catch (err) {
    logger.error('Playlists', 'Error listing playlists', err);
    return { playlists: [], error: 'Failed to list playlists.' };
  }
}

/**
 * Append songs to existing playlist
 * @param {string} userId
 * @param {string} name
 * @param {Object[]} newSongs
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function appendToPlaylist(userId, name, newSongs) {
  const { playlist, error } = await loadPlaylist(userId, name);
  
  if (error) {
    return { success: false, error };
  }
  
  const combinedSongs = [...playlist.songs, ...newSongs];
  
  if (combinedSongs.length > 200) {
    return { success: false, error: `Cannot exceed 200 songs. Current: ${playlist.songs.length}, Adding: ${newSongs.length}` };
  }
  
  return savePlaylist(userId, name, combinedSongs, { createdAt: playlist.createdAt });
}

module.exports = {
  savePlaylist,
  loadPlaylist,
  getPlaylist,
  deletePlaylist,
  listPlaylists,
  appendToPlaylist,
  ensureDirectory
};
