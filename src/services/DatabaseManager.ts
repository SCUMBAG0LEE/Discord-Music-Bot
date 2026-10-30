import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';
import type { FavoriteSong, Playlist, PlaylistSong, PlaylistSummary } from '../types.js';

export interface QueryResult<T = Record<string, any>> {
    results: T[];
    changes: number;
    lastInsertRowid: number | bigint;
}

const PLAYLIST_INSERT_BATCH_SIZE = 15; // 15 * 6 = 90 bound parameters (under Cloudflare D1's 100-param limit)

export class DatabaseManager {
    public isCloud: boolean = false;
    public accountId?: string;
    public databaseId?: string;
    public apiToken?: string;
    public db?: Database;
    public initialized: Promise<void>;

    constructor() {
        this.accountId = process.env.CLOUDFLARE_D1_ACCOUNT_ID;
        this.databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
        this.apiToken = process.env.CLOUDFLARE_D1_API_TOKEN;

        if (this.accountId && this.databaseId && this.apiToken) {
            this.isCloud = true;
            logger.info('Database', 'Cloudflare D1 detected. Running in Cloud Mode.');
        } else {
            logger.info('Database', 'Cloudflare D1 credentials missing. Running in Local SQLite Mode.');
            try {
                this.db = new Database(path.join(process.cwd(), 'music_bot.sqlite'), { create: true });
                this.db.exec('PRAGMA journal_mode = WAL;');
                this.db.exec('PRAGMA foreign_keys = ON;');
            } catch (err) {
                logger.error('Database', 'Failed to initialize local SQLite database', err);
            }
        }

        this.initialized = this.init();
    }

    async init(): Promise<void> {
        try {
            await this.query(`
                CREATE TABLE IF NOT EXISTS favorites (
                    user_id TEXT NOT NULL,
                    url TEXT NOT NULL,
                    title TEXT NOT NULL,
                    duration TEXT NOT NULL,
                    added_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (user_id, url)
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS playlists (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(user_id, name)
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS playlist_songs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    playlist_id INTEGER NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    duration INTEGER NOT NULL,
                    source TEXT NOT NULL,
                    source_url TEXT,
                    added_at INTEGER DEFAULT (strftime('%s', 'now')),
                    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
                )
            `);

            await this.query(`
                CREATE TABLE IF NOT EXISTS server_settings (
                    guild_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (guild_id, key)
                )
            `);

            logger.info('Database', 'Database tables initialized successfully.');

            if (!this.isCloud) {
                this.migrateLegacyPlaylists();
            }
        } catch (err) {
            logger.error('Database', 'Database initialization failed', err);
        }
    }

    async query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
        if (this.isCloud) {
            return await this.queryD1<T>(sql, params);
        } else {
            if (!this.db) {
                throw new Error('Local database is not initialized.');
            }
            const stmt = this.db.prepare(sql);
            const trimmedSql = sql.trim().toUpperCase();
            const isSelect = trimmedSql.startsWith('SELECT') || trimmedSql.startsWith('PRAGMA');

            if (isSelect) {
                const rows = stmt.all(...params) as T[];
                return { results: rows, changes: 0, lastInsertRowid: 0 };
            } else {
                const res = stmt.run(...params);
                return { results: [], changes: res.changes, lastInsertRowid: res.lastInsertRowid };
            }
        }
    }

    async queryD1<T = Record<string, any>>(sql: string, params: any[]): Promise<QueryResult<T>> {
        const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}/query`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sql, params })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error ${response.status}: ${errorText}`);
            }

            const body = (await response.json()) as any;
            if (!body.success) {
                throw new Error(`D1 API Error: ${JSON.stringify(body.errors)}`);
            }

            const resultObj = body.result[0];
            if (!resultObj.success) {
                throw new Error(`SQL Execution Error: ${JSON.stringify(resultObj.meta)}`);
            }

            return {
                results: (resultObj.results || []) as T[],
                changes: resultObj.meta?.changes || 0,
                lastInsertRowid: resultObj.meta?.last_row_id || 0
            };
        } catch (err: any) {
            logger.error('Database', `Cloudflare D1 query error: ${err.message}`);
            throw err;
        }
    }

    /* Favorites Operations */

    async addFavorite(userId: string, url: string, title: string, duration: string): Promise<boolean> {
        await this.initialized;
        const res = await this.query(
            'INSERT OR IGNORE INTO favorites (user_id, url, title, duration) VALUES (?, ?, ?, ?)',
            [userId, url, title, duration]
        );
        return res.changes > 0;
    }

    async getFavorites(userId: string): Promise<FavoriteSong[]> {
        await this.initialized;
        const res = await this.query<FavoriteSong>(
            'SELECT url, title, duration FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 50',
            [userId]
        );
        return res.results;
    }

    async removeFavorite(userId: string, url: string): Promise<boolean> {
        await this.initialized;
        const res = await this.query(
            'DELETE FROM favorites WHERE user_id = ? AND url = ?',
            [userId, url]
        );
        return res.changes > 0;
    }

    /* Playlists Operations */

    private async insertPlaylistSongsChunked(playlistId: number, songs: PlaylistSong[]): Promise<void> {
        for (let i = 0; i < songs.length; i += PLAYLIST_INSERT_BATCH_SIZE) {
            const chunk = songs.slice(i, i + PLAYLIST_INSERT_BATCH_SIZE);
            const sql =
                'INSERT INTO playlist_songs (playlist_id, title, url, duration, source, source_url) VALUES ' +
                chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');

            const params = chunk.flatMap(song => [
                playlistId,
                song.title || song.name || 'Unknown Track',
                song.url,
                song.duration || 0,
                song.source || 'youtube',
                song.sourceUrl || song.url
            ]);

            await this.query(sql, params);
        }
    }

    async savePlaylist(userId: string, name: string, songs: PlaylistSong[]): Promise<{ success: boolean; error: string | null }> {
        await this.initialized;
        if (!name || name.length > 32) {
            return { success: false, error: 'Playlist name must be 1-32 characters.' };
        }
        if (songs.length === 0) {
            return { success: false, error: 'Cannot save empty playlist.' };
        }
        if (songs.length > 200) {
            return { success: false, error: 'Playlist cannot exceed 200 songs.' };
        }

        try {
            const now = new Date().toISOString();
            await this.query(
                'INSERT OR IGNORE INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
                [userId, name, now, now]
            );

            const getPlaylistRes = await this.query<{ id: number }>(
                'SELECT id FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE',
                [userId, name]
            );

            const playlistId = getPlaylistRes.results?.[0]?.id;
            if (!playlistId) throw new Error('Failed to create/retrieve playlist.');

            await this.query('UPDATE playlists SET updated_at = ? WHERE id = ?', [now, playlistId]);
            await this.query('DELETE FROM playlist_songs WHERE playlist_id = ?', [playlistId]);

            await this.insertPlaylistSongsChunked(playlistId, songs);
            return { success: true, error: null };
        } catch (err: any) {
            logger.error('Database', 'Failed to save playlist', err);
            return { success: false, error: err.message };
        }
    }

    async loadPlaylist(userId: string, name: string): Promise<{ playlist: Playlist | null; error: string | null }> {
        await this.initialized;
        try {
            const getPlaylistRes = await this.query<{ id: number; name: string; created_at: string }>(
                'SELECT id, name, created_at FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE',
                [userId, name]
            );
            const playlist = getPlaylistRes.results?.[0];
            if (!playlist) {
                return { playlist: null, error: `Playlist "${name}" not found.` };
            }

            const getSongsRes = await this.query<{
                title: string;
                url: string;
                duration: string | number;
                source: string;
                source_url: string;
            }>(
                'SELECT title, url, duration, source, source_url FROM playlist_songs WHERE playlist_id = ? ORDER BY id ASC',
                [playlist.id]
            );

            return {
                playlist: {
                    name: playlist.name,
                    createdAt: playlist.created_at,
                    songs: getSongsRes.results.map(s => ({
                        title: s.title,
                        url: s.url,
                        duration: s.duration,
                        source: s.source,
                        sourceUrl: s.source_url
                    }))
                },
                error: null
            };
        } catch (err: any) {
            logger.error('Database', 'Failed to load playlist', err);
            return { playlist: null, error: err.message };
        }
    }

    async deletePlaylist(userId: string, name: string): Promise<{ success: boolean; error: string | null }> {
        await this.initialized;
        try {
            const res = await this.query(
                'DELETE FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE',
                [userId, name]
            );
            if (res.changes === 0) {
                return { success: false, error: `Playlist "${name}" not found.` };
            }
            return { success: true, error: null };
        } catch (err: any) {
            logger.error('Database', 'Failed to delete playlist', err);
            return { success: false, error: err.message };
        }
    }

    async listPlaylists(userId: string): Promise<{ playlists: PlaylistSummary[]; error: string | null }> {
        await this.initialized;
        try {
            const res = await this.query<PlaylistSummary>(
                `
                SELECT p.name, p.created_at as createdAt, COUNT(s.id) as songCount 
                FROM playlists p 
                LEFT JOIN playlist_songs s ON p.id = s.playlist_id 
                WHERE p.user_id = ? 
                GROUP BY p.id 
                ORDER BY p.name ASC
            `,
                [userId]
            );
            return { playlists: res.results, error: null };
        } catch (err: any) {
            logger.error('Database', 'Failed to list playlists', err);
            return { playlists: [], error: err.message };
        }
    }

    async appendToPlaylist(userId: string, name: string, newSongs: PlaylistSong[]): Promise<{ success: boolean; error: string | null }> {
        await this.initialized;
        if (newSongs.length === 0) {
            return { success: false, error: 'No songs to append.' };
        }
        try {
            const getPlaylistRes = await this.query<{ id: number }>(
                'SELECT id FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE',
                [userId, name]
            );
            const playlist = getPlaylistRes.results?.[0];
            if (!playlist) throw new Error(`Playlist "${name}" not found.`);
            const playlistId = playlist.id;

            const countRes = await this.query<{ count: number }>(
                'SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = ?',
                [playlistId]
            );
            const currentCount = countRes.results?.[0]?.count || 0;
            if (currentCount + newSongs.length > 200) {
                throw new Error(`Cannot exceed 200 songs. Current: ${currentCount}, Adding: ${newSongs.length}`);
            }

            await this.insertPlaylistSongsChunked(playlistId, newSongs);
            await this.query('UPDATE playlists SET updated_at = ? WHERE id = ?', [new Date().toISOString(), playlistId]);
            return { success: true, error: null };
        } catch (err: any) {
            logger.error('Database', 'Failed to append to playlist', err);
            return { success: false, error: err.message };
        }
    }

    /* Server Settings Operations */

    async getServerSetting(guildId: string, key: string): Promise<string | null> {
        await this.initialized;
        const res = await this.query<{ value: string }>(
            'SELECT value FROM server_settings WHERE guild_id = ? AND key = ?',
            [guildId, key]
        );
        return res.results?.[0]?.value ?? null;
    }

    async setServerSetting(guildId: string, key: string, value: string): Promise<void> {
        await this.initialized;
        await this.query(
            'INSERT INTO server_settings (guild_id, key, value) VALUES (?, ?, ?) ' +
                "ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value, updated_at = (strftime('%s', 'now'))",
            [guildId, key, value]
        );
    }

    async clearServerSettings(guildId: string): Promise<void> {
        await this.initialized;
        await this.query(
            'DELETE FROM server_settings WHERE guild_id = ?',
            [guildId]
        );
    }

    /* Legacy Migration */

    migrateLegacyPlaylists(): void {
        const legacyDir = path.join(process.cwd(), 'data/playlists');
        if (!fs.existsSync(legacyDir)) return;

        try {
            const files = fs.readdirSync(legacyDir);
            const userFiles = files.filter(f => f.endsWith('.json'));
            if (userFiles.length === 0) return;

            logger.info('Database', `Found ${userFiles.length} legacy playlist JSON files. Migrating...`);
            const backupDir = path.join(legacyDir, 'backup_migrated');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            for (const file of userFiles) {
                (async () => {
                    try {
                        const filePath = path.join(legacyDir, file);
                        const fileContent = fs.readFileSync(filePath, 'utf8');
                        const playlist = JSON.parse(fileContent);

                        if (playlist && playlist.userId && playlist.name && Array.isArray(playlist.songs)) {
                            await this.savePlaylist(playlist.userId, playlist.name, playlist.songs);
                            logger.info('Database', `Migrated playlist "${playlist.name}" for user ${playlist.userId}`);
                        }

                        fs.renameSync(filePath, path.join(backupDir, file));
                    } catch (fileErr) {
                        logger.error('Database', `Error migrating file ${file}`, fileErr);
                    }
                })();
            }
        } catch (err) {
            logger.error('Database', 'Failed to run legacy playlist migration', err);
        }
    }
}

export const dbManager = new DatabaseManager();

