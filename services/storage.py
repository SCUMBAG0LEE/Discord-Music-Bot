"""
Storage services for playlists and server settings.
Mirrors the JavaScript version's serverSettings.js and playlists.js
"""

import json
from pathlib import Path
from typing import Any
import time


DATA_DIR = Path("data")


class JsonStorage:
    """Base class for JSON file storage."""
    
    def __init__(self, subdir: str):
        self.directory = DATA_DIR / subdir
        self.directory.mkdir(parents=True, exist_ok=True)
    
    def _get_path(self, key: str) -> Path:
        return self.directory / f"{key}.json"
    
    def load(self, key: str) -> dict:
        path = self._get_path(key)
        if not path.exists():
            return {}
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return {}
    
    def save(self, key: str, data: dict):
        path = self._get_path(key)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    
    def delete(self, key: str) -> bool:
        path = self._get_path(key)
        if path.exists():
            path.unlink()
            return True
        return False


class ServerSettingsService(JsonStorage):
    """Service for per-server settings - mirrors JS serverSettings.js"""
    
    # Default settings matching JS version
    DEFAULT_SETTINGS = {
        'text_channel_id': None,      # Lock to specific text channel (null = any)
        'voice_channel_id': None,     # Lock to specific voice channel (null = any)
        'queue_type': 'linear',       # 'linear' or 'fair' (fair = round-robin between users)
        'auto_playlist': None,        # User ID + Playlist name to auto-load
        'song_in_status': False,      # Show current song in bot status
        'skip_ratio': None,           # Per-server skip ratio (null = use global)
        'default_volume': None,       # Per-server default volume (null = use global)
        'dj_role_id': None,           # Per-server DJ role (null = use global)
        'stay_in_channel': False      # Per-server 24/7 mode
    }
    
    def __init__(self):
        super().__init__("servers")
    
    def get_settings(self, guild_id: int) -> dict:
        """Load settings for a server with defaults."""
        settings = self.load(str(guild_id))
        return {**self.DEFAULT_SETTINGS, **settings}
    
    def get_setting(self, guild_id: int, key: str) -> Any:
        """Get a specific setting."""
        settings = self.get_settings(guild_id)
        return settings.get(key, self.DEFAULT_SETTINGS.get(key))
    
    def set_setting(self, guild_id: int, key: str, value: Any) -> dict:
        """Set a specific setting."""
        settings = self.get_settings(guild_id)
        settings[key] = value
        self.save(str(guild_id), settings)
        return settings
    
    def reset_settings(self, guild_id: int):
        """Reset settings to defaults."""
        self.delete(str(guild_id))
    
    def can_use_text_channel(self, guild_id: int, channel_id: int) -> bool:
        """Check if bot can respond in a text channel."""
        settings = self.get_settings(guild_id)
        if not settings['text_channel_id']:
            return True  # Not locked
        return str(settings['text_channel_id']) == str(channel_id)
    
    def can_use_voice_channel(self, guild_id: int, channel_id: int) -> bool:
        """Check if bot can join a voice channel."""
        settings = self.get_settings(guild_id)
        if not settings['voice_channel_id']:
            return True  # Not locked
        return str(settings['voice_channel_id']) == str(channel_id)
    
    def get_effective_skip_ratio(self, guild_id: int, global_ratio: float) -> float:
        """Get effective skip ratio (per-server or global)."""
        settings = self.get_settings(guild_id)
        return settings['skip_ratio'] if settings['skip_ratio'] is not None else global_ratio
    
    def get_effective_volume(self, guild_id: int, global_volume: int) -> int:
        """Get effective default volume (per-server or global)."""
        settings = self.get_settings(guild_id)
        return settings['default_volume'] if settings['default_volume'] is not None else global_volume
    
    def get_effective_dj_role(self, guild_id: int, global_dj_role: str) -> str:
        """Get effective DJ role (per-server or global)."""
        settings = self.get_settings(guild_id)
        return settings['dj_role_id'] if settings['dj_role_id'] is not None else global_dj_role


class PlaylistService(JsonStorage):
    """Service for user playlists - mirrors JS playlists.js"""
    
    def __init__(self):
        super().__init__("playlists")
    
    def _load_playlists(self, user_id: int) -> dict:
        """Load all playlists for a user."""
        return self.load(str(user_id))
    
    def _save_playlists(self, user_id: int, playlists: dict):
        """Save playlists for a user."""
        self.save(str(user_id), playlists)
    
    def get_playlist(self, user_id: int, name: str) -> dict | None:
        """Get a specific playlist."""
        playlists = self._load_playlists(user_id)
        return playlists.get(name.lower())
    
    def save_playlist(self, user_id: int, name: str, tracks: list) -> dict:
        """Save a playlist (creates or updates)."""
        playlists = self._load_playlists(user_id)
        
        now = int(time.time() * 1000)  # Match JS timestamp format
        
        playlists[name.lower()] = {
            'name': name,
            'tracks': [{
                'title': t.get('title', ''),
                'uri': t.get('uri', ''),
                'author': t.get('author', ''),
                'length': t.get('length', 0),
                'identifier': t.get('identifier', ''),
                'sourceName': t.get('sourceName', '')
            } for t in tracks],
            'createdAt': playlists.get(name.lower(), {}).get('createdAt', now),
            'updatedAt': now
        }
        
        self._save_playlists(user_id, playlists)
        return playlists[name.lower()]
    
    def delete_playlist(self, user_id: int, name: str) -> bool:
        """Delete a playlist."""
        playlists = self._load_playlists(user_id)
        
        if name.lower() not in playlists:
            return False
        
        del playlists[name.lower()]
        self._save_playlists(user_id, playlists)
        return True
    
    def list_playlists(self, user_id: int) -> list:
        """List all playlists for a user."""
        playlists = self._load_playlists(user_id)
        return list(playlists.values())
    
    def append_to_playlist(self, user_id: int, name: str, tracks: list) -> dict | None:
        """Append tracks to an existing playlist."""
        playlist = self.get_playlist(user_id, name)
        if not playlist:
            return None
        
        existing_tracks = playlist.get('tracks', [])
        new_tracks = [{
            'title': t.get('title', ''),
            'uri': t.get('uri', ''),
            'author': t.get('author', ''),
            'length': t.get('length', 0),
            'identifier': t.get('identifier', ''),
            'sourceName': t.get('sourceName', '')
        } for t in tracks]
        
        playlists = self._load_playlists(user_id)
        playlists[name.lower()]['tracks'] = existing_tracks + new_tracks
        playlists[name.lower()]['updatedAt'] = int(time.time() * 1000)
        
        self._save_playlists(user_id, playlists)
        return playlists[name.lower()]


# Global instances
server_settings = ServerSettingsService()
playlist_service = PlaylistService()
