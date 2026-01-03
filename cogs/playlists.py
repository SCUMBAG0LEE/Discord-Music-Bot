"""
Playlists cog - Save and load personal playlists
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import json
import os
import logging
from pathlib import Path

logger = logging.getLogger('MusicBot.Playlists')

PLAYLISTS_DIR = Path("data/playlists")


def ensure_dir():
    """Ensure playlists directory exists."""
    PLAYLISTS_DIR.mkdir(parents=True, exist_ok=True)


def get_playlist_path(user_id: int, name: str) -> Path:
    """Get path to a user's playlist file."""
    safe_name = "".join(c if c.isalnum() else "_" for c in name.lower())
    return PLAYLISTS_DIR / f"{user_id}_{safe_name}.json"


class Playlists(commands.Cog):
    """Personal playlist management."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
        ensure_dir()
    
    @app_commands.command(name="savelist", description="Save the current queue as a playlist")
    @app_commands.describe(name="Playlist name (1-32 characters)")
    async def savelist(self, interaction: discord.Interaction, name: app_commands.Range[str, 1, 32]):
        """Save current queue to a playlist."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or (not player.current and not player.queue):
            await interaction.response.send_message("The queue is empty.", ephemeral=True)
            return
        
        # Collect all tracks
        tracks = []
        if player.current:
            tracks.append({
                "title": player.current.title,
                "uri": player.current.uri,
                "author": player.current.author,
                "length": player.current.length,
            })
        
        for track in player.queue:
            tracks.append({
                "title": track.title,
                "uri": track.uri,
                "author": track.author,
                "length": track.length,
            })
        
        if len(tracks) > 200:
            await interaction.response.send_message("Playlist cannot exceed 200 songs.", ephemeral=True)
            return
        
        # Save to file
        playlist_data = {
            "name": name,
            "user_id": interaction.user.id,
            "tracks": tracks,
        }
        
        path = get_playlist_path(interaction.user.id, name)
        
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(playlist_data, f, indent=2)
            
            await interaction.response.send_message(
                f"💾 Saved **{len(tracks)}** tracks to playlist **{name}**"
            )
        except Exception as e:
            logger.error(f"Failed to save playlist: {e}")
            await interaction.response.send_message("Failed to save playlist.", ephemeral=True)
    
    @app_commands.command(name="loadlist", description="Load a saved playlist into the queue")
    @app_commands.describe(name="Playlist name")
    async def loadlist(self, interaction: discord.Interaction, name: str):
        """Load a playlist into the queue."""
        # Check voice
        member = cast(discord.Member, interaction.user)
        if not member.voice or not member.voice.channel:
            await interaction.response.send_message("You must be in a voice channel!", ephemeral=True)
            return
        
        path = get_playlist_path(interaction.user.id, name)
        
        if not path.exists():
            await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
            return
        
        await interaction.response.defer()
        
        try:
            with open(path, "r", encoding="utf-8") as f:
                playlist_data = json.load(f)
            
            tracks = playlist_data.get("tracks", [])
            
            if not tracks:
                await interaction.followup.send("Playlist is empty.")
                return
            
            # Get or create player
            player = cast(wavelink.Player, interaction.guild.voice_client)
            if not player:
                player = await member.voice.channel.connect(cls=wavelink.Player)
                player.text_channel = interaction.channel
                player.autoplay = wavelink.AutoPlayMode.partial
                player.skip_votes = set()
            
            # Load tracks
            loaded = 0
            for track_data in tracks:
                try:
                    # Search for the track by URI
                    results = await wavelink.Playable.search(track_data["uri"])
                    if results:
                        track = results[0] if not isinstance(results, wavelink.Playlist) else results.tracks[0]
                        await player.queue.put_wait(track)
                        loaded += 1
                except Exception as e:
                    logger.warning(f"Failed to load track {track_data.get('title')}: {e}")
                    continue
            
            # Start playing if not already
            if not player.playing and player.queue:
                await player.play(player.queue.get())
            
            await interaction.followup.send(
                f"📂 Loaded **{loaded}/{len(tracks)}** tracks from playlist **{playlist_data['name']}**"
            )
            
        except Exception as e:
            logger.error(f"Failed to load playlist: {e}")
            await interaction.followup.send("Failed to load playlist.")
    
    @app_commands.command(name="deletelist", description="Delete a saved playlist")
    @app_commands.describe(name="Playlist name")
    async def deletelist(self, interaction: discord.Interaction, name: str):
        """Delete a playlist."""
        path = get_playlist_path(interaction.user.id, name)
        
        if not path.exists():
            await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
            return
        
        try:
            path.unlink()
            await interaction.response.send_message(f"🗑️ Deleted playlist **{name}**")
        except Exception as e:
            logger.error(f"Failed to delete playlist: {e}")
            await interaction.response.send_message("Failed to delete playlist.", ephemeral=True)
    
    @app_commands.command(name="playlists", description="List your saved playlists")
    async def playlists(self, interaction: discord.Interaction):
        """List all playlists for the user."""
        user_id = interaction.user.id
        
        ensure_dir()
        
        playlists = []
        for file in PLAYLISTS_DIR.glob(f"{user_id}_*.json"):
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    playlists.append({
                        "name": data.get("name", "Unknown"),
                        "count": len(data.get("tracks", []))
                    })
            except:
                continue
        
        if not playlists:
            await interaction.response.send_message(
                "You have no saved playlists. Use `/savelist` to create one!",
                ephemeral=True
            )
            return
        
        embed = discord.Embed(
            title="📚 Your Playlists",
            color=discord.Color.blurple()
        )
        
        description = "\n".join(
            f"**{i+1}.** {p['name']} — {p['count']} tracks"
            for i, p in enumerate(playlists)
        )
        embed.description = description
        embed.set_footer(text="Use /loadlist <name> to play a playlist")
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="appendlist", description="Add current queue to an existing playlist")
    @app_commands.describe(name="Playlist name")
    async def appendlist(self, interaction: discord.Interaction, name: str):
        """Append current queue to an existing playlist."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or (not player.current and not player.queue):
            await interaction.response.send_message("The queue is empty.", ephemeral=True)
            return
        
        path = get_playlist_path(interaction.user.id, name)
        
        if not path.exists():
            await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
            return
        
        try:
            with open(path, "r", encoding="utf-8") as f:
                playlist_data = json.load(f)
            
            existing_count = len(playlist_data.get("tracks", []))
            
            # Collect new tracks
            new_tracks = []
            if player.current:
                new_tracks.append({
                    "title": player.current.title,
                    "uri": player.current.uri,
                    "author": player.current.author,
                    "length": player.current.length,
                })
            
            for track in player.queue:
                new_tracks.append({
                    "title": track.title,
                    "uri": track.uri,
                    "author": track.author,
                    "length": track.length,
                })
            
            total = existing_count + len(new_tracks)
            if total > 200:
                await interaction.response.send_message(
                    f"Cannot exceed 200 songs. Current: {existing_count}, Adding: {len(new_tracks)}",
                    ephemeral=True
                )
                return
            
            playlist_data["tracks"].extend(new_tracks)
            
            with open(path, "w", encoding="utf-8") as f:
                json.dump(playlist_data, f, indent=2)
            
            await interaction.response.send_message(
                f"➕ Added **{len(new_tracks)}** tracks to playlist **{name}**"
            )
            
        except Exception as e:
            logger.error(f"Failed to append to playlist: {e}")
            await interaction.response.send_message("Failed to append to playlist.", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(Playlists(bot))
