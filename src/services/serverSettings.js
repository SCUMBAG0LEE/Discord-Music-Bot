const fs = require('fs');
const path = require('path');

const SETTINGS_DIR = path.join(__dirname, '../../data/servers');

// Ensure directory exists
if (!fs.existsSync(SETTINGS_DIR)) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
}

// Default server settings
const defaultSettings = {
  textChannelId: null,     // Lock to specific text channel (null = any)
  voiceChannelId: null,    // Lock to specific voice channel (null = any)
  queueType: 'linear',     // 'linear' or 'fair' (fair = round-robin between users)
  autoPlaylist: null,      // User ID + Playlist name to auto-load
  songInStatus: false,     // Show current song in bot status
  skipRatio: null,         // Per-server skip ratio (null = use global)
  defaultVolume: null,     // Per-server default volume (null = use global)
  djRoleId: null,          // Per-server DJ role (null = use global)
  stayInChannel: false     // Per-server 24/7 mode
};

/**
 * Get settings file path for a server
 */
function getSettingsPath(guildId) {
  return path.join(SETTINGS_DIR, `${guildId}.json`);
}

/**
 * Load settings for a server
 */
function loadSettings(guildId) {
  const filePath = getSettingsPath(guildId);
  if (!fs.existsSync(filePath)) {
    return { ...defaultSettings };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...defaultSettings, ...data };
  } catch {
    return { ...defaultSettings };
  }
}

/**
 * Save settings for a server
 */
function saveSettings(guildId, settings) {
  const filePath = getSettingsPath(guildId);
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}

/**
 * Get a specific setting
 */
function getSetting(guildId, key) {
  const settings = loadSettings(guildId);
  return settings[key];
}

/**
 * Set a specific setting
 */
function setSetting(guildId, key, value) {
  const settings = loadSettings(guildId);
  settings[key] = value;
  saveSettings(guildId, settings);
  return settings;
}

/**
 * Reset settings to defaults
 */
function resetSettings(guildId) {
  const filePath = getSettingsPath(guildId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Check if bot can respond in a text channel
 */
function canUseTextChannel(guildId, channelId) {
  const settings = loadSettings(guildId);
  if (!settings.textChannelId) return true; // Not locked
  return settings.textChannelId === channelId;
}

/**
 * Check if bot can join a voice channel
 */
function canUseVoiceChannel(guildId, channelId) {
  const settings = loadSettings(guildId);
  if (!settings.voiceChannelId) return true; // Not locked
  return settings.voiceChannelId === channelId;
}

/**
 * Get effective skip ratio (per-server or global)
 */
function getEffectiveSkipRatio(guildId, globalRatio) {
  const settings = loadSettings(guildId);
  return settings.skipRatio ?? globalRatio;
}

/**
 * Get effective default volume (per-server or global)
 */
function getEffectiveVolume(guildId, globalVolume) {
  const settings = loadSettings(guildId);
  return settings.defaultVolume ?? globalVolume;
}

/**
 * Get effective DJ role (per-server or global)
 */
function getEffectiveDJRole(guildId, globalDJRole) {
  const settings = loadSettings(guildId);
  return settings.djRoleId ?? globalDJRole;
}

module.exports = {
  defaultSettings,
  loadSettings,
  saveSettings,
  getSetting,
  setSetting,
  resetSettings,
  canUseTextChannel,
  canUseVoiceChannel,
  getEffectiveSkipRatio,
  getEffectiveVolume,
  getEffectiveDJRole
};
