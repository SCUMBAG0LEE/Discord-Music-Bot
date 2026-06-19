/**
 * Server Settings Service
 * Manages per-server configuration (text/voice lock, queue type, skip ratio, etc.)
 */

import fs from 'fs';
import path from 'path';
import { dbManager } from './DatabaseManager.js';

// Default server settings
export const defaultSettings = {
  textChannelId: null,     // Lock to specific text channel (null = any)
  voiceChannelId: null,    // Lock to specific voice channel (null = any)
  queueType: 'linear',     // 'linear' or 'fair' (fair = round-robin between users)
  autoPlaylist: null,      // { userId, name } - Playlist to auto-load
  songInStatus: false,     // Show current song in bot status
  skipRatio: null,         // Per-server skip ratio (null = use global)
  defaultVolume: null,     // Per-server default volume (null = use global)
  djRoleId: null,          // Per-server DJ role (null = use global)
  stayInChannel: false,    // Per-server 24/7 mode
  maxDuration: null,       // Per-server max song duration in seconds (null = use global)
  announceNowPlaying: true // Announce now playing messages
};

/**
 * Load settings for a server
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function loadSettings(guildId) {
  try {
    const res = await dbManager.query(
      'SELECT key, value FROM server_settings WHERE guild_id = ?',
      [guildId]
    );

    const settings = { ...defaultSettings };
    if (res.results && res.results.length > 0) {
      for (const row of res.results) {
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch {
          settings[row.key] = row.value; // Fallback to raw string
        }
      }
    }
    return settings;
  } catch (err) {
    console.error(`[serverSettings] Failed to load settings for guild ${guildId}:`, err);
    return { ...defaultSettings };
  }
}

/**
 * Save settings for a server
 * @param {string} guildId
 * @param {object} settings
 * @returns {Promise<void>}
 */
export async function saveSettings(guildId, settings) {
  try {
    for (const [key, value] of Object.entries(settings)) {
      await dbManager.setServerSetting(guildId, key, JSON.stringify(value));
    }
  } catch (err) {
    console.error(`[serverSettings] Failed to save settings for guild ${guildId}:`, err);
  }
}

/**
 * Get a specific setting
 * @param {string} guildId
 * @param {string} key
 * @returns {Promise<any>}
 */
export async function getSetting(guildId, key) {
  try {
    const val = await dbManager.getServerSetting(guildId, key);
    if (val === null) return defaultSettings[key];
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  } catch (err) {
    console.error(`[serverSettings] Failed to get setting ${key} for guild ${guildId}:`, err);
    return defaultSettings[key];
  }
}

/**
 * Set a specific setting
 * @param {string} guildId
 * @param {string} key
 * @param {any} value
 * @returns {Promise<object>} Updated settings
 */
export async function setSetting(guildId, key, value) {
  try {
    await dbManager.setServerSetting(guildId, key, JSON.stringify(value));
  } catch (err) {
    console.error(`[serverSettings] Failed to set setting ${key} for guild ${guildId}:`, err);
  }
  return await loadSettings(guildId);
}

/**
 * Reset settings to defaults
 * @param {string} guildId
 * @returns {Promise<void>}
 */
export async function resetSettings(guildId) {
  try {
    await dbManager.clearServerSettings(guildId);
  } catch (err) {
    console.error(`[serverSettings] Failed to reset settings for guild ${guildId}:`, err);
  }
}

/**
 * Check if bot can respond in a text channel
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function canUseTextChannel(guildId, channelId) {
  const settings = await loadSettings(guildId);
  if (!settings.textChannelId) return true; // Not locked
  return settings.textChannelId === channelId;
}

/**
 * Check if bot can join a voice channel
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<boolean>}
 */
export async function canUseVoiceChannel(guildId, channelId) {
  const settings = await loadSettings(guildId);
  if (!settings.voiceChannelId) return true; // Not locked
  return settings.voiceChannelId === channelId;
}

/**
 * Get effective skip ratio (per-server or global)
 * @param {string} guildId
 * @param {number} globalRatio
 * @returns {Promise<number>}
 */
export async function getEffectiveSkipRatio(guildId, globalRatio) {
  const settings = await loadSettings(guildId);
  return settings.skipRatio ?? globalRatio;
}

/**
 * Get effective default volume (per-server or global)
 * @param {string} guildId
 * @param {number} globalVolume
 * @returns {Promise<number>}
 */
export async function getEffectiveVolume(guildId, globalVolume) {
  const settings = await loadSettings(guildId);
  return settings.defaultVolume ?? globalVolume;
}

/**
 * Get effective DJ role (per-server or global)
 * @param {string} guildId
 * @param {string} globalDJRole
 * @returns {Promise<string|null>}
 */
export async function getEffectiveDJRole(guildId, globalDJRole) {
  const settings = await loadSettings(guildId);
  return settings.djRoleId ?? globalDJRole;
}

// Run legacy migration asynchronously if running locally
if (!dbManager.isCloud) {
  migrateLegacySettings().catch(err => {
    console.error('[serverSettings] Error running legacy migration:', err);
  });
}

/**
 * Migrate local JSON files to DB
 */
async function migrateLegacySettings() {
  const settingsDir = path.join(process.cwd(), 'data/servers');
  if (!fs.existsSync(settingsDir)) return;
  try {
    const files = fs.readdirSync(settingsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    if (jsonFiles.length === 0) return;
    
    console.log(`[serverSettings/Migration] Found ${jsonFiles.length} server settings files. Migrating to database...`);
    const backupDir = path.join(settingsDir, 'backup_migrated');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    for (const file of jsonFiles) {
      try {
        const guildId = file.replace('.json', '');
        const filePath = path.join(settingsDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const settings = JSON.parse(fileContent);
        
        for (const [key, value] of Object.entries(settings)) {
          await dbManager.setServerSetting(guildId, key, JSON.stringify(value));
        }
        console.log(`[serverSettings/Migration] Migrated settings for guild ${guildId}`);
        fs.renameSync(filePath, path.join(backupDir, file));
      } catch (fileErr) {
        console.error(`[serverSettings/Migration] Error migrating settings file ${file}:`, fileErr);
      }
    }
  } catch (err) {
    console.error('[serverSettings/Migration] Failed to run legacy settings migration:', err);
  }
}
