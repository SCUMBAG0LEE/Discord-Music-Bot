"""
Music cog - Core playback commands
Handles play, pause, resume, skip, stop, volume, seek, etc.
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import Optional, cast
import logging

logger = logging.getLogger('MusicBot.Music')


def format_duration(ms: int) -> str:
    """Format milliseconds to mm:ss or hh:mm:ss."""
    seconds = ms // 1000
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


class Music(commands.Cog):
    """Core music playback commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    async def ensure_voice(self, interaction: discord.Interaction) -> Optional[wavelink.Player]:
        """Ensure user is in voice and bot can connect. Returns player or None."""
        if not interaction.guild:
            await interaction.response.send_message("This command can only be used in a server.", ephemeral=True)
            return None
        
        member = cast(discord.Member, interaction.user)
        if not member.voice or not member.voice.channel:
            await interaction.response.send_message("You must be in a voice channel!", ephemeral=True)
            return None
        
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        # If bot not connected, connect to user's channel
        if not player:
            try:
                player = await member.voice.channel.connect(cls=wavelink.Player)
                player.text_channel = interaction.channel
                player.autoplay = wavelink.AutoPlayMode.partial  # Enable autoplay
                player.skip_votes = set()
            except discord.ClientException:
                await interaction.response.send_message("Failed to connect to voice channel.", ephemeral=True)
                return None
        
        # Check if user is in same channel as bot
        elif player.channel and member.voice.channel != player.channel:
            await interaction.response.send_message(
                f"You must be in {player.channel.mention} to use music commands!", 
                ephemeral=True
            )
            return None
        
        return player
    
    @app_commands.command(name="play", description="Play a song from YouTube, Spotify, SoundCloud, or search")
    @app_commands.describe(query="URL or search term")
    async def play(self, interaction: discord.Interaction, query: str):
        """Play a track or add it to the queue."""
        player = await self.ensure_voice(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        try:
            # Wavelink handles all source detection automatically
            # Supports: YouTube, Spotify, SoundCloud, direct URLs, etc.
            tracks = await wavelink.Playable.search(query)
            
            if not tracks:
                await interaction.followup.send("❌ No results found.")
                return
            
            # Handle playlist vs single track
            if isinstance(tracks, wavelink.Playlist):
                # Add all tracks from playlist
                added = await player.queue.put_wait(tracks)
                await interaction.followup.send(
                    f"✅ Added playlist **{tracks.name}** ({len(tracks.tracks)} tracks) to the queue"
                )
            else:
                track = tracks[0]
                await player.queue.put_wait(track)
                
                if player.playing:
                    await interaction.followup.send(
                        f"✅ Added to queue: **{track.title}** - `{format_duration(track.length)}`"
                    )
                else:
                    await interaction.followup.send(
                        f"🎵 Now playing: **{track.title}** - `{format_duration(track.length)}`"
                    )
            
            # Start playing if not already
            if not player.playing:
                await player.play(player.queue.get())
                
        except wavelink.LavalinkLoadException as e:
            logger.error(f"Failed to load track: {e}")
            await interaction.followup.send(f"❌ Failed to load: {e.message}")
        except Exception as e:
            logger.error(f"Play error: {e}")
            await interaction.followup.send(f"❌ Error: {str(e)[:200]}")
    
    @app_commands.command(name="pause", description="Pause playback")
    async def pause(self, interaction: discord.Interaction):
        """Pause the current track."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        await player.pause(True)
        await interaction.response.send_message("⏸️ Playback paused.")
    
    @app_commands.command(name="resume", description="Resume playback")
    async def resume(self, interaction: discord.Interaction):
        """Resume playback."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        await player.pause(False)
        await interaction.response.send_message("▶️ Playback resumed.")
    
    @app_commands.command(name="skip", description="Skip the current song")
    async def skip(self, interaction: discord.Interaction):
        """Skip to the next track."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        await player.skip()
        await interaction.response.send_message("⏭️ Skipped.")
    
    @app_commands.command(name="voteskip", description="Vote to skip the current song")
    async def voteskip(self, interaction: discord.Interaction):
        """Vote to skip - requires 50% of voice channel members."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        member = cast(discord.Member, interaction.user)
        
        if not hasattr(player, 'skip_votes'):
            player.skip_votes = set()
        
        if member.id in player.skip_votes:
            await interaction.response.send_message("You already voted to skip.", ephemeral=True)
            return
        
        player.skip_votes.add(member.id)
        
        # Calculate threshold
        channel = player.channel
        members = sum(1 for m in channel.members if not m.bot)
        threshold = max(1, members // 2)
        current = len(player.skip_votes)
        
        if current >= threshold:
            player.skip_votes.clear()
            await player.skip()
            await interaction.response.send_message(f"⏭️ Vote passed ({current}/{threshold}). Skipping.")
        else:
            await interaction.response.send_message(f"🗳️ Vote registered ({current}/{threshold})")
    
    @app_commands.command(name="stop", description="Stop playback and clear the queue")
    async def stop(self, interaction: discord.Interaction):
        """Stop playback and disconnect."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        await player.disconnect()
        await interaction.response.send_message("⏹️ Stopped and disconnected.")
    
    @app_commands.command(name="volume", description="Set the playback volume (0-200)")
    @app_commands.describe(level="Volume level (0-200, default is 100)")
    async def volume(self, interaction: discord.Interaction, level: app_commands.Range[int, 0, 200]):
        """Set playback volume."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        await player.set_volume(level)
        
        emoji = "🔇" if level == 0 else "🔈" if level < 50 else "🔉" if level < 100 else "🔊"
        await interaction.response.send_message(f"{emoji} Volume set to **{level}%**")
    
    @app_commands.command(name="seek", description="Seek to a position in the current track")
    @app_commands.describe(position="Position to seek to (e.g., 1:30, 90, 2:15:30)")
    async def seek(self, interaction: discord.Interaction, position: str):
        """Seek to a specific position."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        if player.current.is_stream:
            await interaction.response.send_message("Cannot seek in a live stream.", ephemeral=True)
            return
        
        # Parse timestamp
        try:
            parts = position.split(':')
            parts = [int(p) for p in parts]
            
            if len(parts) == 1:
                seconds = parts[0]
            elif len(parts) == 2:
                seconds = parts[0] * 60 + parts[1]
            elif len(parts) == 3:
                seconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
            else:
                raise ValueError("Invalid format")
            
            ms = seconds * 1000
        except (ValueError, IndexError):
            await interaction.response.send_message(
                "Invalid format. Use: `1:30`, `90`, or `2:15:30`", 
                ephemeral=True
            )
            return
        
        if ms > player.current.length:
            await interaction.response.send_message(
                f"Cannot seek past track duration ({format_duration(player.current.length)}).",
                ephemeral=True
            )
            return
        
        await player.seek(ms)
        await interaction.response.send_message(f"⏩ Seeked to **{format_duration(ms)}**")
    
    @app_commands.command(name="nowplaying", description="Show the currently playing track")
    async def nowplaying(self, interaction: discord.Interaction):
        """Display current track with progress."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.current:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        track = player.current
        position = player.position
        
        embed = discord.Embed(
            title="🎵 Now Playing",
            description=f"**[{track.title}]({track.uri})**",
            color=discord.Color.blurple()
        )
        
        if track.artwork:
            embed.set_thumbnail(url=track.artwork)
        
        # Progress bar for non-streams
        if not track.is_stream:
            progress = position / track.length
            bar_length = 15
            filled = int(progress * bar_length)
            bar = "▬" * filled + "🔘" + "▬" * (bar_length - filled - 1)
            
            embed.add_field(
                name="Progress",
                value=f"{bar}\n{format_duration(position)} / {format_duration(track.length)}",
                inline=False
            )
        else:
            embed.add_field(name="Duration", value="🔴 LIVE", inline=True)
        
        embed.add_field(name="Author", value=track.author, inline=True)
        embed.add_field(name="Volume", value=f"{player.volume}%", inline=True)
        
        # Status indicators
        status = []
        if player.paused:
            status.append("⏸️ Paused")
        if player.autoplay != wavelink.AutoPlayMode.disabled:
            status.append("📻 Autoplay")
        if hasattr(player, 'loop_mode') and player.loop_mode:
            status.append("🔁 Loop")
        
        if status:
            embed.set_footer(text=" • ".join(status))
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="loop", description="Toggle loop mode")
    @app_commands.describe(mode="Loop mode")
    @app_commands.choices(mode=[
        app_commands.Choice(name="Off", value="off"),
        app_commands.Choice(name="Track", value="track"),
        app_commands.Choice(name="Queue", value="queue"),
    ])
    async def loop(self, interaction: discord.Interaction, mode: str = None):
        """Toggle or set loop mode."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        if mode is None:
            # Cycle through modes
            if not hasattr(player, 'loop_mode'):
                player.loop_mode = 'off'
            
            cycle = {'off': 'track', 'track': 'queue', 'queue': 'off'}
            mode = cycle[player.loop_mode]
        
        player.loop_mode = mode
        
        # Configure queue behavior
        if mode == 'track':
            player.queue.mode = wavelink.QueueMode.loop
            await interaction.response.send_message("🔂 Looping **current track**")
        elif mode == 'queue':
            player.queue.mode = wavelink.QueueMode.loop_all
            await interaction.response.send_message("🔁 Looping **queue**")
        else:
            player.queue.mode = wavelink.QueueMode.normal
            await interaction.response.send_message("➡️ Loop **disabled**")
    
    @app_commands.command(name="autoplay", description="Toggle autoplay - automatically queue related songs")
    async def autoplay(self, interaction: discord.Interaction):
        """Toggle autoplay mode."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        if player.autoplay == wavelink.AutoPlayMode.disabled:
            player.autoplay = wavelink.AutoPlayMode.partial
            await interaction.response.send_message("📻 Autoplay **enabled** — Related songs will be added when the queue ends.")
        else:
            player.autoplay = wavelink.AutoPlayMode.disabled
            await interaction.response.send_message("📻 Autoplay **disabled**")
    
    @app_commands.command(name="replay", description="Restart the current track")
    async def replay(self, interaction: discord.Interaction):
        """Replay the current track from the beginning."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.current:
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        
        await player.seek(0)
        await interaction.response.send_message(f"🔁 Replaying **{player.current.title}**")
    
    @app_commands.command(name="previous", description="Play the previous track")
    async def previous(self, interaction: discord.Interaction):
        """Play the previous track from history."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        if not player.queue.history:
            await interaction.response.send_message("No previous track available.", ephemeral=True)
            return
        
        # Get the previous track from history
        track = player.queue.history[-1]
        
        # Put current track back in front of queue if playing
        if player.current:
            player.queue.put_at(0, player.current)
        
        await player.play(track)
        await interaction.response.send_message(f"⏮️ Playing previous: **{track.title}**")


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
