"""
Storage services for playlists and server settings.
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
    """Service for per-server settings."""
    
    DEFAULT_SETTINGS = {
        'text_channel_id': None,
        'voice_channel_id': None,
        'queue_type': 'linear',  # 'linear' or 'fair'
        'auto_playlist': None,
        'song_in_status': False,
        'skip_ratio': None,  # None = use global default
        'default_volume': None,
        'dj_role_id': None,
        'stay_in_channel': False
    }
    
    def __init__(self):
        super().__init__("servers")
    
    def get_settings(self, guild_id: int) -> dict:
        settings = self.load(str(guild_id))
        return {**self.DEFAULT_SETTINGS, **settings}
    
    def get_setting(self, guild_id: int, key: str) -> Any:
        settings = self.get_settings(guild_id)
        return settings.get(key, self.DEFAULT_SETTINGS.get(key))
    
    def set_setting(self, guild_id: int, key: str, value: Any) -> dict:
        settings = self.get_settings(guild_id)
        settings[key] = value
        self.save(str(guild_id), settings)
        return settings
    
    def can_use_text_channel(self, guild_id: int, channel_id: int) -> bool:
        settings = self.get_settings(guild_id)
        if not settings['text_channel_id']:
            return True
        return int(settings['text_channel_id']) == channel_id
    
    def can_use_voice_channel(self, guild_id: int, channel_id: int) -> bool:
        settings = self.get_settings(guild_id)
        if not settings['voice_channel_id']:
            return True
        return int(settings['voice_channel_id']) == channel_id
    
    def get_effective_skip_ratio(self, guild_id: int, global_ratio: float) -> float:
        settings = self.get_settings(guild_id)
        return settings['skip_ratio'] if settings['skip_ratio'] is not None else global_ratio


# Global instance
server_settings = ServerSettingsService()
