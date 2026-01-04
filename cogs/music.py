"""
Music cog - Core playback commands
Mirrors JS play.js, playback.js, and settings.js commands
Handles play, pause, resume, skip, stop, volume, seek, etc.
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import Optional, cast
import logging

from services.storage import server_settings
from services.utils import format_duration, is_owner, is_dj, parse_timestamp

logger = logging.getLogger('MusicBot.Music')


def can_dj(interaction: discord.Interaction, player: wavelink.Player) -> bool:
    """Check if user can use DJ commands (DJ, owner, or requester)."""
    member = cast(discord.Member, interaction.user)
    
    if is_dj(member, interaction.client):
        return True
    
    # Check if user is the requester of current track
    if player.current and hasattr(player.current, 'requester'):
        return player.current.requester == member
    
    return False


class Music(commands.Cog):
    """Core music playback commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    def _get_fair_position(self, queue: wavelink.Queue, requester_id: int) -> int:
        """Find position for fair queue insertion - mirrors JS getFairPosition."""
        if len(queue) == 0:
            return 0
        
        # Find the last track by this user
        last_user_index = -1
        for i in range(len(queue) - 1, -1, -1):
            track = queue[i]
            if hasattr(track, 'requester') and track.requester and track.requester.id == requester_id:
                last_user_index = i
                break
        
        if last_user_index == -1:
            # User has no tracks, add at the end
            return len(queue)
        
        # Find next position after the user's last track where another user's track is
        for i in range(last_user_index + 1, len(queue)):
            track = queue[i]
            if hasattr(track, 'requester') and track.requester and track.requester.id != requester_id:
                return i
        
        return len(queue)
    
    def _is_too_long(self, track, max_duration: int) -> bool:
        """Check if track exceeds max duration (0 = unlimited)."""
        if max_duration <= 0:
            return False
        return track.length > max_duration * 1000
    
    async def ensure_voice(self, interaction: discord.Interaction) -> Optional[wavelink.Player]:
        """Ensure user is in voice and bot can connect. Returns player or None."""
        if not interaction.guild:
            await interaction.response.send_message("This command can only be used in a server.", ephemeral=True)
            return None
        
        member = cast(discord.Member, interaction.user)
        if not member.voice or not member.voice.channel:
            await interaction.response.send_message("You must be in a voice channel!", ephemeral=True)
            return None
        
        # Check voice channel lock
        if not server_settings.can_use_voice_channel(interaction.guild_id, member.voice.channel.id):
            settings = server_settings.get_settings(interaction.guild_id)
            await interaction.response.send_message(
                f"❌ Bot is locked to <#{settings['voice_channel_id']}>. Please join that channel.", 
                ephemeral=True
            )
            return None
        
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        # If bot not connected, connect to user's channel
        if not player:
            try:
                player = await member.voice.channel.connect(cls=wavelink.Player)
                player.text_channel = interaction.channel
                player.autoplay = wavelink.AutoPlayMode.partial
                player.skip_votes = set()
                
                # Set default volume from config
                if hasattr(self.bot, 'config'):
                    volume = server_settings.get_effective_volume(
                        interaction.guild_id, 
                        self.bot.config.default_volume
                    )
                    await player.set_volume(volume)
                
                # Load autoplaylist if configured
                if hasattr(self.bot, 'load_autoplaylist'):
                    await self.bot.load_autoplaylist(player, interaction.guild_id)
                    
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
    
    @app_commands.command(name="play", description="Play music from YouTube, Spotify, SoundCloud, or search")
    @app_commands.describe(query="URL or search term")
    async def play(self, interaction: discord.Interaction, query: str):
        """Play a track or add it to the queue - mirrors JS play.js."""
        player = await self.ensure_voice(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        settings = server_settings.get_settings(interaction.guild_id)
        config = getattr(self.bot, 'config', None)
        max_queue = config.max_queue_size if config else 0
        max_duration = config.max_duration if config else 0
        
        try:
            # Check max queue size before searching
            if max_queue > 0 and len(player.queue) >= max_queue:
                return await interaction.followup.send(f"❌ Queue is full (max {max_queue} tracks).")
            
            tracks = await wavelink.Playable.search(query)
            
            if not tracks:
                return await interaction.followup.send("❌ No results found.")
            
            # Handle playlist vs single track
            if isinstance(tracks, wavelink.Playlist):
                added = 0
                skipped = 0
                
                for track in tracks.tracks:
                    # Check queue limit
                    if max_queue > 0 and len(player.queue) >= max_queue:
                        break
                    
                    # Check duration limit
                    if self._is_too_long(track, max_duration):
                        skipped += 1
                        continue
                    
                    track.requester = interaction.user
                    
                    # Use fair position for fair queue mode
                    if settings['queue_type'] == 'fair':
                        pos = self._get_fair_position(player.queue, interaction.user.id)
                        player.queue.put_at(pos, track)
                    else:
                        await player.queue.put_wait(track)
                    
                    added += 1
                
                msg = f"✅ Added **{added}** tracks from **{tracks.name}**"
                if skipped > 0:
                    msg += f" ({skipped} skipped - too long)"
                if max_queue > 0 and len(player.queue) >= max_queue:
                    msg += " (queue full)"
                if settings['queue_type'] == 'fair':
                    msg += " 🔄"
                
                await interaction.followup.send(msg)
            else:
                track = tracks[0]
                
                # Check duration limit
                if self._is_too_long(track, max_duration):
                    return await interaction.followup.send(f"❌ Track is too long (max {max_duration}s).")
                
                track.requester = interaction.user
                
                # Use fair position for fair queue mode
                if settings['queue_type'] == 'fair' and len(player.queue) > 0:
                    pos = self._get_fair_position(player.queue, interaction.user.id)
                    player.queue.put_at(pos, track)
                    
                    if player.playing:
                        await interaction.followup.send(
                            f"✅ Added to queue (position {pos + 2}): **{track.title}** - `{format_duration(track.length)}` 🔄"
                        )
                    else:
                        await interaction.followup.send(f"🎵 Now playing: **{track.title}** - `{format_duration(track.length)}`")
                else:
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
            if not player.playing and player.queue:
                player.suppress_now_playing = True
                await player.play(player.queue.get())
                
        except wavelink.LavalinkLoadException as e:
            logger.error(f"Failed to load track: {e}")
            await interaction.followup.send(f"❌ Failed to load: {e.message}")
        except Exception as e:
            logger.error(f"Play error: {e}")
            await interaction.followup.send(f"❌ Error: {str(e)[:200]}")
    
    @app_commands.command(name="search", description="Search for a song and choose from results")
    @app_commands.describe(query="Search term")
    async def search(self, interaction: discord.Interaction, query: str):
        """Search and select from results."""
        player = await self.ensure_voice(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        try:
            tracks = await wavelink.Playable.search(query)
            
            if not tracks or isinstance(tracks, wavelink.Playlist):
                return await interaction.followup.send("❌ No results found.")
            
            # Show up to 5 results
            results = tracks[:5]
            
            embed = discord.Embed(title=f"🔎 Search: {query}", color=discord.Color.blurple())
            for i, track in enumerate(results, 1):
                embed.add_field(
                    name=f"{i}. {track.title}",
                    value=f"`{format_duration(track.length)}` by {track.author}",
                    inline=False
                )
            
            # Create select menu
            class SearchSelect(discord.ui.Select):
                def __init__(self, tracks, player, requester):
                    self.tracks = tracks
                    self.player = player
                    self.requester = requester
                    options = [
                        discord.SelectOption(label=f"{i}. {t.title[:95]}", value=str(i-1))
                        for i, t in enumerate(tracks, 1)
                    ]
                    super().__init__(placeholder="Select a song...", options=options)
                
                async def callback(self, inter: discord.Interaction):
                    track = self.tracks[int(self.values[0])]
                    track.requester = self.requester
                    await self.player.queue.put_wait(track)
                    
                    if not self.player.playing:
                        self.player.suppress_now_playing = True
                        await self.player.play(self.player.queue.get())
                        await inter.response.edit_message(
                            content=f"🎵 Now playing: **{track.title}**", embed=None, view=None
                        )
                    else:
                        await inter.response.edit_message(
                            content=f"✅ Added: **{track.title}**", embed=None, view=None
                        )
            
            view = discord.ui.View(timeout=30)
            view.add_item(SearchSelect(results, player, interaction.user))
            
            await interaction.followup.send(embed=embed, view=view)
            
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}")
    
    @app_commands.command(name="playnext", description="Add a song to play next in the queue")
    @app_commands.describe(query="URL or search term")
    async def playnext(self, interaction: discord.Interaction, query: str):
        """Add track to play next."""
        player = await self.ensure_voice(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        try:
            tracks = await wavelink.Playable.search(query)
            
            if not tracks:
                return await interaction.followup.send("❌ No results found.")
            
            track = tracks[0] if not isinstance(tracks, wavelink.Playlist) else tracks.tracks[0]
            track.requester = interaction.user
            
            # Insert at position 0 in queue
            player.queue.put_at(0, track)
            
            await interaction.followup.send(
                f"⏭️ Added to play next: **{track.title}** - `{format_duration(track.length)}`"
            )
            
            if not player.playing:
                player.suppress_now_playing = True
                await player.play(player.queue.get())
                
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}")
    
    @app_commands.command(name="forceplay", description="Force play a song immediately (DJ only)")
    @app_commands.describe(query="URL or search term")
    async def forceplay(self, interaction: discord.Interaction, query: str):
        """Force play - skips current track and plays immediately."""
        if not is_dj(cast(discord.Member, interaction.user)):
            return await interaction.response.send_message("🔒 DJ only.", ephemeral=True)
        
        player = await self.ensure_voice(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        try:
            tracks = await wavelink.Playable.search(query)
            
            if not tracks:
                return await interaction.followup.send("❌ No results found.")
            
            track = tracks[0] if not isinstance(tracks, wavelink.Playlist) else tracks.tracks[0]
            track.requester = interaction.user
            
            # Put current track back in queue if playing
            if player.current:
                player.queue.put_at(0, player.current)
            
            player.suppress_now_playing = True
            await player.play(track)
            await interaction.followup.send(f"⚡ Force playing: **{track.title}**")
            
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}")
    
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
    
    @app_commands.command(name="skip", description="Skip the current song (DJ/requester can force skip)")
    async def skip(self, interaction: discord.Interaction):
        """Skip to the next track - DJ/requester can force, others vote."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            return await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        
        # DJ, owner, or requester can force skip
        if can_dj(interaction, player):
            await player.skip()
            return await interaction.response.send_message("⏭️ Skipped.")
        
        # Otherwise, vote skip
        member = cast(discord.Member, interaction.user)
        if not hasattr(player, 'skip_votes'):
            player.skip_votes = set()
        
        if member.id in player.skip_votes:
            return await interaction.response.send_message("You already voted to skip.", ephemeral=True)
        
        player.skip_votes.add(member.id)
        
        # Calculate votes needed with config
        listeners = sum(1 for m in player.channel.members if not m.bot)
        config = getattr(self.bot, 'config', None)
        global_ratio = config.skip_ratio if config else 0.5
        skip_ratio = server_settings.get_effective_skip_ratio(interaction.guild_id, global_ratio)
        threshold = max(1, int(listeners * skip_ratio + 0.5))
        current = len(player.skip_votes)
        
        if current >= threshold:
            player.skip_votes.clear()
            await player.skip()
            await interaction.response.send_message(f"⏭️ Vote passed! Skipped.")
        else:
            await interaction.response.send_message(f"🗳️ Skip vote: **{current}/{threshold}**")
    
    @app_commands.command(name="forceskip", description="Force skip the current track (DJ only)")
    async def forceskip(self, interaction: discord.Interaction):
        """Force skip - DJ only."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            return await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        
        if not is_dj(cast(discord.Member, interaction.user), self.bot):
            return await interaction.response.send_message("🔒 This command requires DJ permissions.", ephemeral=True)
        
        title = player.current.title
        await player.skip()
        await interaction.response.send_message(f"⏭️ Force skipped **{title}**")
    
    @app_commands.command(name="voteskip", description="Vote to skip the current song")
    async def voteskip(self, interaction: discord.Interaction):
        """Vote to skip with configurable ratio."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or not player.playing:
            return await interaction.response.send_message("Nothing is playing.", ephemeral=True)
        
        member = cast(discord.Member, interaction.user)
        
        if not hasattr(player, 'skip_votes'):
            player.skip_votes = set()
        
        if member.id in player.skip_votes:
            return await interaction.response.send_message("You already voted to skip.", ephemeral=True)
        
        player.skip_votes.add(member.id)
        
        # Calculate votes needed with config
        listeners = sum(1 for m in player.channel.members if not m.bot)
        config = getattr(self.bot, 'config', None)
        global_ratio = config.skip_ratio if config else 0.5
        skip_ratio = server_settings.get_effective_skip_ratio(interaction.guild_id, global_ratio)
        threshold = max(1, int(listeners * skip_ratio + 0.5))
        current = len(player.skip_votes)
        
        if current >= threshold:
            title = player.current.title
            player.skip_votes.clear()
            await player.skip()
            await interaction.response.send_message(f"⏭️ Vote passed! Skipped **{title}**")
        else:
            await interaction.response.send_message(f"🗳️ Skip vote: **{current}/{threshold}** votes")
    
    @app_commands.command(name="stop", description="Stop playback and clear the queue")
    async def stop(self, interaction: discord.Interaction):
        """Stop playback and disconnect."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        await player.disconnect()
        await interaction.response.send_message("⏹️ Stopped and disconnected.")
    
    @app_commands.command(name="volume", description="Set playback volume (0-150)")
    @app_commands.describe(level="Volume level (0-150)")
    async def volume(self, interaction: discord.Interaction, level: app_commands.Range[int, 0, 150]):
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
        
        player.suppress_now_playing = True
        await player.play(track)
        await interaction.response.send_message(f"⏮️ Playing previous: **{track.title}**")


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
