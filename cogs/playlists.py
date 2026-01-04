"""
Playlists cog - Save and load personal playlists
Mirrors JS playlists.js commands
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import logging

from services.storage import playlist_service

logger = logging.getLogger('MusicBot.Playlists')


def format_duration(ms: int) -> str:
    """Format milliseconds to mm:ss or hh:mm:ss."""
    seconds = ms // 1000
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


class Playlists(commands.Cog):
    """Personal playlist management - mirrors JS playlists.js."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="savelist", description="Save the current queue as a playlist")
    @app_commands.describe(name="Playlist name (max 32 characters)")
    async def savelist(self, interaction: discord.Interaction, name: app_commands.Range[str, 1, 32]):
        """Save current queue to a playlist - mirrors JS savelist."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or (not player.current and not player.queue):
            return await interaction.response.send_message("Nothing in the queue to save.", ephemeral=True)
        
        # Collect all tracks (current + queue)
        tracks = []
        if player.current:
            tracks.append({
                'title': player.current.title,
                'uri': player.current.uri,
                'author': player.current.author,
                'length': player.current.length,
                'identifier': getattr(player.current, 'identifier', ''),
                'sourceName': getattr(player.current, 'source', '')
            })
        
        for track in player.queue:
            tracks.append({
                'title': track.title,
                'uri': track.uri,
                'author': track.author,
                'length': track.length,
                'identifier': getattr(track, 'identifier', ''),
                'sourceName': getattr(track, 'source', '')
            })
        
        if not tracks:
            return await interaction.response.send_message("Queue is empty.", ephemeral=True)
        
        # Save playlist using the service
        playlist = playlist_service.save_playlist(interaction.user.id, name, tracks)
        
        await interaction.response.send_message(
            f"💾 Saved **{playlist['name']}** with {len(playlist['tracks'])} tracks."
        )
    
    @app_commands.command(name="loadlist", description="Load and play a saved playlist")
    @app_commands.describe(name="Playlist name")
    async def loadlist(self, interaction: discord.Interaction, name: str):
        """Load a playlist into the queue - mirrors JS loadlist."""
        # Check voice
        member = cast(discord.Member, interaction.user)
        if not member.voice or not member.voice.channel:
            return await interaction.response.send_message("You need to be in a voice channel.", ephemeral=True)
        
        playlist = playlist_service.get_playlist(interaction.user.id, name)
        
        if not playlist:
            return await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
        
        await interaction.response.defer()
        
        tracks = playlist.get('tracks', [])
        if not tracks:
            return await interaction.followup.send("Playlist is empty.")
        
        try:
            # Get or create player
            player = cast(wavelink.Player, interaction.guild.voice_client)
            if not player:
                player = await member.voice.channel.connect(cls=wavelink.Player)
                player.text_channel = interaction.channel
                player.autoplay = wavelink.AutoPlayMode.partial
                player.skip_votes = set()
                
                # Set default volume
                if hasattr(self.bot, 'config'):
                    await player.set_volume(self.bot.config.default_volume)
            
            # Search and add each track
            added = 0
            for track_data in tracks:
                try:
                    result = await wavelink.Playable.search(track_data.get('uri') or track_data.get('title'))
                    
                    if result:
                        track = result[0] if not isinstance(result, wavelink.Playlist) else result.tracks[0]
                        track.requester = interaction.user
                        await player.queue.put_wait(track)
                        added += 1
                except Exception as e:
                    logger.warning(f"Failed to load track: {e}")
                    continue
            
            # Start playing if not already
            if not player.playing and player.queue:
                await player.play(player.queue.get())
            
            await interaction.followup.send(
                f"📂 Loaded **{playlist['name']}** - added {added}/{len(tracks)} tracks."
            )
            
        except Exception as e:
            logger.error(f"Loadlist error: {e}")
            await interaction.followup.send("❌ An error occurred loading the playlist.")
    
    @app_commands.command(name="deletelist", description="Delete a saved playlist")
    @app_commands.describe(name="Playlist name")
    async def deletelist(self, interaction: discord.Interaction, name: str):
        """Delete a playlist - mirrors JS deletelist."""
        if playlist_service.delete_playlist(interaction.user.id, name):
            await interaction.response.send_message(f"🗑️ Deleted playlist **{name}**")
        else:
            await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
    
    @app_commands.command(name="playlists", description="View your saved playlists")
    async def playlists(self, interaction: discord.Interaction):
        """List all playlists for the user - mirrors JS playlists."""
        playlists = playlist_service.list_playlists(interaction.user.id)
        
        if not playlists:
            return await interaction.response.send_message(
                "You have no saved playlists. Use `/savelist` to create one.",
                ephemeral=True
            )
        
        embed = discord.Embed(
            title="📋 Your Playlists",
            color=discord.Color.from_str('#5865F2')
        )
        
        description_lines = []
        for i, p in enumerate(playlists, 1):
            tracks = p.get('tracks', [])
            total_duration = sum(t.get('length', 0) for t in tracks)
            description_lines.append(
                f"**{i}.** {p['name']} - {len(tracks)} tracks `{format_duration(total_duration)}`"
            )
        
        embed.description = "\n".join(description_lines)
        embed.set_footer(text=f"{len(playlists)} playlists total")
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="appendlist", description="Add current queue to an existing playlist")
    @app_commands.describe(name="Playlist name")
    async def appendlist(self, interaction: discord.Interaction, name: str):
        """Append current queue to an existing playlist - mirrors JS appendlist."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or (not player.current and not player.queue):
            return await interaction.response.send_message("The queue is empty.", ephemeral=True)
        
        playlist = playlist_service.get_playlist(interaction.user.id, name)
        if not playlist:
            return await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
        
        # Collect new tracks
        new_tracks = []
        if player.current:
            new_tracks.append({
                'title': player.current.title,
                'uri': player.current.uri,
                'author': player.current.author,
                'length': player.current.length,
                'identifier': getattr(player.current, 'identifier', ''),
                'sourceName': getattr(player.current, 'source', '')
            })
        
        for track in player.queue:
            new_tracks.append({
                'title': track.title,
                'uri': track.uri,
                'author': track.author,
                'length': track.length,
                'identifier': getattr(track, 'identifier', ''),
                'sourceName': getattr(track, 'source', '')
            })
        
        if not new_tracks:
            return await interaction.response.send_message("No tracks to add.", ephemeral=True)
        
        # Append to playlist
        updated = playlist_service.append_to_playlist(interaction.user.id, name, new_tracks)
        
        if updated:
            await interaction.response.send_message(
                f"📥 Added **{len(new_tracks)}** tracks to **{updated['name']}** (now {len(updated['tracks'])} total)"
            )
        else:
            await interaction.response.send_message("Failed to update playlist.", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(Playlists(bot))
