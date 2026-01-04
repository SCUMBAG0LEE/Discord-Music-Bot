const fs = require('fs');
const path = require('path');

const PLAYLISTS_DIR = path.join(__dirname, '../../data/playlists');

// Ensure directory exists
if (!fs.existsSync(PLAYLISTS_DIR)) {
  fs.mkdirSync(PLAYLISTS_DIR, { recursive: true });
}

/**
 * Get playlist file path for a user
 */
function getPlaylistPath(userId) {
  return path.join(PLAYLISTS_DIR, `${userId}.json`);
}

/**
 * Load all playlists for a user
 */
function loadPlaylists(userId) {
  const filePath = getPlaylistPath(userId);
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save playlists for a user
 */
function savePlaylists(userId, playlists) {
  const filePath = getPlaylistPath(userId);
  fs.writeFileSync(filePath, JSON.stringify(playlists, null, 2));
}

/**
 * Get a specific playlist
 */
function getPlaylist(userId, name) {
  const playlists = loadPlaylists(userId);
  return playlists[name.toLowerCase()];
}

/**
 * Save a playlist
 */
function savePlaylist(userId, name, tracks) {
  const playlists = loadPlaylists(userId);
  playlists[name.toLowerCase()] = {
    name: name,
    tracks: tracks.map(t => ({
      title: t.title,
      uri: t.uri,
      author: t.author,
      length: t.length,
      identifier: t.identifier,
      sourceName: t.sourceName
    })),
    createdAt: playlists[name.toLowerCase()]?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  savePlaylists(userId, playlists);
  return playlists[name.toLowerCase()];
}

/**
 * Delete a playlist
 */
function deletePlaylist(userId, name) {
  const playlists = loadPlaylists(userId);
  if (!playlists[name.toLowerCase()]) {
    return false;
  }
  delete playlists[name.toLowerCase()];
  savePlaylists(userId, playlists);
  return true;
}

/**
 * List all playlists for a user
 */
function listPlaylists(userId) {
  const playlists = loadPlaylists(userId);
  return Object.values(playlists);
}

module.exports = {
  loadPlaylists,
  savePlaylists,
  getPlaylist,
  savePlaylist,
  deletePlaylist,
  listPlaylists
};
