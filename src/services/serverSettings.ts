import fs from 'fs';
import path from 'path';
import { dbManager } from './DatabaseManager.js';
import { logger } from '../utils/logger.js';
import type { ServerSettings } from '../types.js';

interface CachedSettingsEntry {
    data: ServerSettings;
    ts: number;
}

const settingsCache = new Map<string, CachedSettingsEntry>();
const CACHE_TTL = 60_000; // 60 seconds

export const defaultSettings: ServerSettings = {
    textChannelId: null,
    voiceChannelId: null,
    queueType: 'linear',
    autoPlaylist: null,
    songInStatus: false,
    skipRatio: null,
    defaultVolume: null,
    djRoleId: null,
    stayInChannel: false,
    maxDuration: null,
    announceNowPlaying: true
};

/**
 * Load settings for a server
 */
export async function loadSettings(guildId: string): Promise<ServerSettings> {
    if (!guildId) return { ...defaultSettings };

    const cached = settingsCache.get(guildId);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return { ...cached.data };
    }

    try {
        await dbManager.initialized;
        const res = await dbManager.query<{ key: string; value: string }>(
            'SELECT key, value FROM server_settings WHERE guild_id = ?',
            [guildId]
        );

        const settings: ServerSettings = { ...defaultSettings };
        if (res.results && res.results.length > 0) {
            for (const row of res.results) {
                try {
                    settings[row.key] = JSON.parse(row.value);
                } catch {
                    settings[row.key] = row.value;
                }
            }
        }

        settingsCache.set(guildId, { data: settings, ts: Date.now() });
        return { ...settings };
    } catch (err) {
        logger.error('ServerSettings', `Failed to load settings for guild ${guildId}`, err);
        return { ...defaultSettings };
    }
}

/**
 * Save settings for a server
 */
export async function saveSettings(guildId: string, settings: Partial<ServerSettings>): Promise<void> {
    try {
        for (const [key, value] of Object.entries(settings)) {
            await dbManager.setServerSetting(guildId, key, JSON.stringify(value));
        }
        settingsCache.delete(guildId);
    } catch (err) {
        logger.error('ServerSettings', `Failed to save settings for guild ${guildId}`, err);
    }
}

/**
 * Get a specific setting
 */
export async function getSetting<K extends keyof ServerSettings>(guildId: string, key: K): Promise<ServerSettings[K]> {
    try {
        const val = await dbManager.getServerSetting(guildId, String(key));
        if (val === null) return defaultSettings[key];
        try {
            return JSON.parse(val) as ServerSettings[K];
        } catch {
            return val as unknown as ServerSettings[K];
        }
    } catch (err) {
        logger.error('ServerSettings', `Failed to get setting ${String(key)} for guild ${guildId}`, err);
        return defaultSettings[key];
    }
}

/**
 * Set a specific setting
 */
export async function setSetting<K extends keyof ServerSettings>(
    guildId: string,
    key: K,
    value: ServerSettings[K]
): Promise<ServerSettings> {
    try {
        await dbManager.setServerSetting(guildId, String(key), JSON.stringify(value));
        settingsCache.delete(guildId);
    } catch (err) {
        logger.error('ServerSettings', `Failed to set setting ${String(key)} for guild ${guildId}`, err);
    }
    return await loadSettings(guildId);
}

/**
 * Reset settings to defaults
 */
export async function resetSettings(guildId: string): Promise<void> {
    try {
        await dbManager.clearServerSettings(guildId);
        settingsCache.delete(guildId);
    } catch (err) {
        logger.error('ServerSettings', `Failed to reset settings for guild ${guildId}`, err);
    }
}

/**
 * Check if bot can respond in a text channel
 */
export async function canUseTextChannel(guildId: string, channelId: string): Promise<boolean> {
    const settings = await loadSettings(guildId);
    if (!settings.textChannelId) return true;
    return settings.textChannelId === channelId;
}

/**
 * Check if bot can join a voice channel
 */
export async function canUseVoiceChannel(guildId: string, channelId: string): Promise<boolean> {
    const settings = await loadSettings(guildId);
    if (!settings.voiceChannelId) return true;
    return settings.voiceChannelId === channelId;
}

/**
 * Get effective skip ratio (per-server or global)
 */
export async function getEffectiveSkipRatio(guildId: string, globalRatio: number): Promise<number> {
    const settings = await loadSettings(guildId);
    return settings.skipRatio ?? globalRatio;
}

/**
 * Get effective default volume (per-server or global)
 */
export async function getEffectiveVolume(guildId: string, globalVolume: number): Promise<number> {
    const settings = await loadSettings(guildId);
    return settings.defaultVolume ?? globalVolume;
}

/**
 * Get effective DJ role (per-server or global)
 */
export async function getEffectiveDJRole(guildId: string, globalDJRole?: string | null): Promise<string | null> {
    const settings = await loadSettings(guildId);
    return settings.djRoleId ?? globalDJRole ?? null;
}

if (!dbManager.isCloud) {
    migrateLegacySettings().catch(err => {
        logger.error('ServerSettings', 'Error running legacy migration', err);
    });
}

async function migrateLegacySettings(): Promise<void> {
    await dbManager.initialized;
    const settingsDir = path.join(process.cwd(), 'data/servers');
    if (!fs.existsSync(settingsDir)) return;
    try {
        const files = fs.readdirSync(settingsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        if (jsonFiles.length === 0) return;

        logger.info('ServerSettings', `Found ${jsonFiles.length} server settings files. Migrating to database...`);
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
                logger.info('ServerSettings', `Migrated settings for guild ${guildId}`);
                fs.renameSync(filePath, path.join(backupDir, file));
            } catch (fileErr) {
                logger.error('ServerSettings', `Error migrating settings file ${file}`, fileErr);
            }
        }
    } catch (err) {
        logger.error('ServerSettings', 'Failed to run legacy settings migration', err);
    }
}

