import { Database } from 'bun:sqlite';
import path from 'path';
import fs from 'fs';

class DatabaseManager {
    constructor() {
        // Creates or opens a local sqlite database
        this.db = new Database(path.join(process.cwd(), 'music_bot.sqlite'), { create: true });
        this.db.exec('PRAGMA foreign_keys = ON;');
        this.init();
        this.migrateLegacyPlaylists();
    }

    init() {
        // Ultra-fast favorites table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS favorites (
                user_id TEXT NOT NULL,
                url TEXT NOT NULL,
                title TEXT NOT NULL,
                duration TEXT NOT NULL,
                added_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, url)
            )
        `);

        // Playlists tables
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, name)
            )
        `);

        this.db.exec(`
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
        
        // Prepare statements for max performance
        this.addFavoriteStmt = this.db.prepare('INSERT OR IGNORE INTO favorites (user_id, url, title, duration) VALUES (?, ?, ?, ?)');
        this.getFavoritesStmt = this.db.prepare('SELECT url, title, duration FROM favorites WHERE user_id = ? ORDER BY added_at DESC LIMIT 50');
        this.removeFavoriteStmt = this.db.prepare('DELETE FROM favorites WHERE user_id = ? AND url = ?');

        // Playlist prepared statements
        this.insertPlaylistStmt = this.db.prepare('INSERT OR IGNORE INTO playlists (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)');
        this.getPlaylistByNameStmt = this.db.prepare('SELECT id, name, created_at FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE');
        this.clearPlaylistSongsStmt = this.db.prepare('DELETE FROM playlist_songs WHERE playlist_id = ?');
        this.insertPlaylistSongStmt = this.db.prepare('INSERT INTO playlist_songs (playlist_id, title, url, duration, source, source_url) VALUES (?, ?, ?, ?, ?, ?)');
        this.getPlaylistSongsStmt = this.db.prepare('SELECT title, url, duration, source, source_url FROM playlist_songs WHERE playlist_id = ? ORDER BY added_at ASC');
        this.deletePlaylistStmt = this.db.prepare('DELETE FROM playlists WHERE user_id = ? AND name = ? COLLATE NOCASE');
        this.listPlaylistsStmt = this.db.prepare(`
            SELECT p.name, p.created_at as createdAt, COUNT(s.id) as songCount 
            FROM playlists p 
            LEFT JOIN playlist_songs s ON p.id = s.playlist_id 
            WHERE p.user_id = ? 
            GROUP BY p.id 
            ORDER BY p.name ASC
        `);
        this.countPlaylistSongsStmt = this.db.prepare('SELECT COUNT(*) as count FROM playlist_songs WHERE playlist_id = ?');
    }

    addFavorite(userId, url, title, duration) {
        return this.addFavoriteStmt.run(userId, url, title, duration).changes > 0;
    }

    getFavorites(userId) {
        return this.getFavoritesStmt.all(userId);
    }

    removeFavorite(userId, url) {
        return this.removeFavoriteStmt.run(userId, url).changes > 0;
    }

    savePlaylist(userId, name, songs) {
        if (!name || name.length > 32) {
            return { success: false, error: 'Playlist name must be 1-32 characters.' };
        }
        if (songs.length === 0) {
            return { success: false, error: 'Cannot save empty playlist.' };
        }
        if (songs.length > 200) {
            return { success: false, error: 'Playlist cannot exceed 200 songs.' };
        }

        const transaction = this.db.transaction((userId, name, songs) => {
            this.insertPlaylistStmt.run(userId, name, new Date().toISOString(), new Date().toISOString());
            const playlist = this.getPlaylistByNameStmt.get(userId, name);
            if (!playlist) throw new Error("Failed to create playlist");
            const playlistId = playlist.id;

            this.clearPlaylistSongsStmt.run(playlistId);

            for (const song of songs) {
                this.insertPlaylistSongStmt.run(
                    playlistId,
                    song.title || song.name,
                    song.url,
                    song.duration || 0,
                    song.source || 'youtube',
                    song.sourceUrl || song.url
                );
            }
        });
        
        try {
            transaction(userId, name, songs);
            return { success: true, error: null };
        } catch (err) {
            console.error("Failed to save playlist to SQLite:", err);
            return { success: false, error: err.message };
        }
    }

    loadPlaylist(userId, name) {
        try {
            const playlist = this.getPlaylistByNameStmt.get(userId, name);
            if (!playlist) {
                return { playlist: null, error: `Playlist "${name}" not found.` };
            }
            const songs = this.getPlaylistSongsStmt.all(playlist.id);
            return {
                playlist: {
                    name: playlist.name,
                    createdAt: playlist.created_at,
                    songs: songs.map(s => ({
                        title: s.title,
                        url: s.url,
                        duration: s.duration,
                        source: s.source,
                        sourceUrl: s.source_url
                    }))
                },
                error: null
            };
        } catch (err) {
            console.error("Failed to load playlist from SQLite:", err);
            return { playlist: null, error: err.message };
        }
    }

    deletePlaylist(userId, name) {
        try {
            const result = this.deletePlaylistStmt.run(userId, name);
            if (result.changes === 0) {
                return { success: false, error: `Playlist "${name}" not found.` };
            }
            return { success: true, error: null };
        } catch (err) {
            console.error("Failed to delete playlist from SQLite:", err);
            return { success: false, error: err.message };
        }
    }

    listPlaylists(userId) {
        try {
            const playlists = this.listPlaylistsStmt.all(userId);
            return { playlists, error: null };
        } catch (err) {
            console.error("Failed to list playlists from SQLite:", err);
            return { playlists: [], error: err.message };
        }
    }

    appendToPlaylist(userId, name, newSongs) {
        const transaction = this.db.transaction((userId, name, newSongs) => {
            const playlist = this.getPlaylistByNameStmt.get(userId, name);
            if (!playlist) throw new Error(`Playlist "${name}" not found.`);
            const playlistId = playlist.id;

            const currentCount = this.countPlaylistSongsStmt.get(playlistId).count;
            if (currentCount + newSongs.length > 200) {
                throw new Error(`Cannot exceed 200 songs. Current: ${currentCount}, Adding: ${newSongs.length}`);
            }

            for (const song of newSongs) {
                this.insertPlaylistSongStmt.run(
                    playlistId,
                    song.title || song.name,
                    song.url,
                    song.duration || 0,
                    song.source || 'youtube',
                    song.sourceUrl || song.url
                );
            }
        });

        try {
            transaction(userId, name, newSongs);
            return { success: true, error: null };
        } catch (err) {
            console.error("Failed to append to playlist in SQLite:", err);
            return { success: false, error: err.message };
        }
    }

    migrateLegacyPlaylists() {
        const legacyDir = path.join(process.cwd(), 'data/playlists');
        if (!fs.existsSync(legacyDir)) return;

        try {
            const files = fs.readdirSync(legacyDir);
            const userFiles = files.filter(f => f.endsWith('.json'));
            if (userFiles.length === 0) return;

            console.log(`[Migration] Found ${userFiles.length} legacy playlist JSON files. Migrating to SQLite...`);
            const backupDir = path.join(legacyDir, 'backup_migrated');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            for (const file of userFiles) {
                try {
                    const filePath = path.join(legacyDir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf8');
                    const playlist = JSON.parse(fileContent);

                    if (playlist && playlist.userId && playlist.name && Array.isArray(playlist.songs)) {
                        this.savePlaylist(playlist.userId, playlist.name, playlist.songs);
                        console.log(`[Migration] Successfully migrated playlist "${playlist.name}" for user ${playlist.userId}`);
                    }
                    
                    fs.renameSync(filePath, path.join(backupDir, file));
                } catch (fileErr) {
                    console.error(`[Migration] Error migrating file ${file}:`, fileErr);
                }
            }
        } catch (err) {
            console.error('[Migration] Failed to run legacy playlist migration:', err);
        }
    }
}

export const dbManager = new DatabaseManager();
