"""
Shared utility functions for the music bot.
Consolidates common functions used across cogs.
"""

import os
import discord
from discord.ext import commands
from services.storage import server_settings


def format_duration(ms: int) -> str:
    """Format milliseconds to mm:ss or hh:mm:ss."""
    if not ms or ms < 0:
        return "0:00"
    seconds = ms // 1000
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


def is_owner(user_id: int) -> bool:
    """Check if user is the bot owner."""
    owner_id = os.getenv('OWNER_ID')
    return owner_id and str(user_id) == owner_id


def is_dj(member: discord.Member, bot: commands.Bot = None) -> bool:
    """Check if member has DJ permissions."""
    if is_owner(member.id):
        return True
    if member.guild_permissions.administrator:
        return True
    if member.guild_permissions.manage_guild:
        return True
    
    # Check per-server DJ role first
    dj_role_id = server_settings.get_setting(member.guild.id, 'dj_role_id')
    
    # Fall back to global DJ role from config
    if not dj_role_id and bot and hasattr(bot, 'config'):
        dj_role_id = bot.config.dj_role_id
    
    if dj_role_id:
        return any(str(r.id) == str(dj_role_id) for r in member.roles)
    
    return True  # No DJ role set = everyone is DJ


def parse_timestamp(timestamp: str) -> int | None:
    """Parse timestamp string to seconds. Returns None if invalid."""
    try:
        parts = timestamp.split(':')
        parts = [int(p) for p in parts]
        
        if len(parts) == 1:
            return parts[0]
        elif len(parts) == 2:
            return parts[0] * 60 + parts[1]
        elif len(parts) == 3:
            return parts[0] * 3600 + parts[1] * 60 + parts[2]
        return None
    except (ValueError, IndexError):
        return None
