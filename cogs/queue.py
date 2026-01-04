"""
Queue cog - Queue management commands
Handles queue display, shuffle, clear, remove, move, jump, etc.
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import logging

from services.utils import format_duration

logger = logging.getLogger('MusicBot.Queue')


class QueueView(discord.ui.View):
    """Paginated queue view with buttons."""
    
    def __init__(self, player: wavelink.Player, author_id: int):
        super().__init__(timeout=60)
        self.player = player
        self.author_id = author_id
        self.page = 0
        self.items_per_page = 10
    
    @property
    def total_pages(self) -> int:
        total = len(self.player.queue) + (1 if self.player.current else 0)
        return max(1, (total + self.items_per_page - 1) // self.items_per_page)
    
    def generate_embed(self) -> discord.Embed:
        """Generate embed for current page."""
        queue = self.player.queue
        current = self.player.current
        
        # Build list with current track + queue
        all_tracks = []
        if current:
            all_tracks.append(current)
        all_tracks.extend(queue)
        
        # Calculate total duration
        total_ms = sum(t.length for t in all_tracks if not t.is_stream)
        
        # Paginate
        start = self.page * self.items_per_page
        end = start + self.items_per_page
        page_tracks = all_tracks[start:end]
        
        # Build description
        lines = []
        for i, track in enumerate(page_tracks, start=start + 1):
            now_playing = " 🎵" if i == 1 and current else ""
            duration = "🔴 LIVE" if track.is_stream else f"`{format_duration(track.length)}`"
            lines.append(f"**{i}.** [{track.title}]({track.uri}) {duration}{now_playing}")
        
        description = "\n".join(lines) if lines else "Queue is empty."
        
        embed = discord.Embed(
            title="📋 Current Queue",
            description=description,
            color=discord.Color.blurple()
        )
        
        # Footer with stats
        embed.set_footer(
            text=f"Page {self.page + 1}/{self.total_pages} • "
                 f"{len(all_tracks)} tracks • "
                 f"{format_duration(total_ms)} total • "
                 f"Volume: {self.player.volume}%"
        )
        
        return embed
    
    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message("These buttons aren't for you!", ephemeral=True)
            return False
        return True
    
    @discord.ui.button(label="Previous", style=discord.ButtonStyle.secondary)
    async def previous_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.page = max(0, self.page - 1)
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)
    
    @discord.ui.button(label="Next", style=discord.ButtonStyle.secondary)
    async def next_page(self, interaction: discord.Interaction, button: discord.ui.Button):
        self.page = min(self.total_pages - 1, self.page + 1)
        await interaction.response.edit_message(embed=self.generate_embed(), view=self)
    
    async def on_timeout(self):
        for item in self.children:
            item.disabled = True


class Queue(commands.Cog):
    """Queue management commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="queue", description="Display the current queue")
    async def queue(self, interaction: discord.Interaction):
        """Show the current queue with pagination."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        if not player.current and not player.queue:
            await interaction.response.send_message("The queue is empty.", ephemeral=True)
            return
        
        view = QueueView(player, interaction.user.id)
        await interaction.response.send_message(embed=view.generate_embed(), view=view)
    
    @app_commands.command(name="shuffle", description="Shuffle the queue")
    async def shuffle(self, interaction: discord.Interaction):
        """Shuffle the queue."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or len(player.queue) < 2:
            await interaction.response.send_message("Not enough songs to shuffle.", ephemeral=True)
            return
        
        player.queue.shuffle()
        await interaction.response.send_message(f"🔀 Shuffled {len(player.queue)} tracks!")
    
    @app_commands.command(name="clear", description="Clear the queue (keeps current track)")
    async def clear(self, interaction: discord.Interaction):
        """Clear all tracks from the queue."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        count = len(player.queue)
        player.queue.clear()
        await interaction.response.send_message(f"🗑️ Cleared **{count}** tracks from the queue.")
    
    @app_commands.command(name="remove", description="Remove a track from the queue by position")
    @app_commands.describe(position="Position in queue (starting at 2)")
    async def remove(self, interaction: discord.Interaction, position: app_commands.Range[int, 2, 1000]):
        """Remove a specific track from the queue."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        # Position 2 = index 0 in queue (1 is current track)
        index = position - 2
        
        if index >= len(player.queue):
            await interaction.response.send_message(
                f"Invalid position. Queue only has {len(player.queue) + 1} tracks.",
                ephemeral=True
            )
            return
        
        track = player.queue[index]
        del player.queue[index]
        await interaction.response.send_message(f"🗑️ Removed **{track.title}** from the queue.")
    
    @app_commands.command(name="forceremove", description="Force remove tracks by position or user (DJ only)")
    @app_commands.describe(
        position="Position to remove (2+)",
        user="Remove all tracks from this user"
    )
    async def forceremove(
        self,
        interaction: discord.Interaction,
        position: app_commands.Range[int, 2, 1000] = None,
        user: discord.Member = None
    ):
        """Force remove - DJ only."""
        import os
        owner_id = os.getenv('OWNER_ID')
        member = cast(discord.Member, interaction.user)
        
        # Check DJ
        is_admin = member.guild_permissions.administrator or member.guild_permissions.manage_guild
        is_owner = owner_id and str(member.id) == owner_id
        
        if not is_admin and not is_owner:
            # Check DJ role
            from services.storage import server_settings
            dj_role = server_settings.get_setting(interaction.guild_id, 'dj_role_id')
            if dj_role and not any(str(r.id) == dj_role for r in member.roles):
                return await interaction.response.send_message("🔒 DJ only.", ephemeral=True)
        
        player = cast(wavelink.Player, interaction.guild.voice_client)
        if not player or not player.queue:
            return await interaction.response.send_message("Queue is empty.", ephemeral=True)
        
        if position is not None:
            index = position - 2
            if index >= len(player.queue):
                return await interaction.response.send_message("Invalid position.", ephemeral=True)
            
            removed = player.queue[index]
            del player.queue[index]
            requester = getattr(removed, 'requester', None)
            await interaction.response.send_message(
                f"🗑️ Force removed **{removed.title}** (by {requester.mention if requester else 'Unknown'})"
            )
        
        elif user is not None:
            removed_count = 0
            i = 0
            while i < len(player.queue):
                track = player.queue[i]
                requester = getattr(track, 'requester', None)
                if requester and requester.id == user.id:
                    del player.queue[i]
                    removed_count += 1
                else:
                    i += 1
            
            if removed_count == 0:
                return await interaction.response.send_message(f"No tracks from {user.mention}.", ephemeral=True)
            
            await interaction.response.send_message(f"🗑️ Removed **{removed_count}** tracks by {user.mention}.")
        
        else:
            await interaction.response.send_message("Provide a position or user.", ephemeral=True)
    
    @app_commands.command(name="move", description="Move a track to a different position")
    @app_commands.describe(
        from_pos="Current position (starting at 2)",
        to_pos="New position"
    )
    async def move(
        self, 
        interaction: discord.Interaction, 
        from_pos: app_commands.Range[int, 2, 1000],
        to_pos: app_commands.Range[int, 2, 1000]
    ):
        """Move a track within the queue."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player or len(player.queue) < 2:
            await interaction.response.send_message("Not enough tracks to move.", ephemeral=True)
            return
        
        from_idx = from_pos - 2
        to_idx = to_pos - 2
        
        if from_idx >= len(player.queue) or to_idx >= len(player.queue):
            await interaction.response.send_message(
                f"Invalid positions. Queue has {len(player.queue) + 1} tracks.",
                ephemeral=True
            )
            return
        
        track = player.queue[from_idx]
        del player.queue[from_idx]
        player.queue.put_at(to_idx, track)
        
        await interaction.response.send_message(
            f"↔️ Moved **{track.title}** from position {from_pos} to {to_pos}."
        )
    
    @app_commands.command(name="jump", description="Jump to a specific track in the queue")
    @app_commands.describe(position="Position to jump to (starting at 2)")
    async def jump(self, interaction: discord.Interaction, position: app_commands.Range[int, 2, 1000]):
        """Skip to a specific track in the queue."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        index = position - 2
        
        if index >= len(player.queue):
            await interaction.response.send_message(
                f"Invalid position. Queue only has {len(player.queue) + 1} tracks.",
                ephemeral=True
            )
            return
        
        # Remove all tracks before the target
        for _ in range(index):
            player.queue.get()
        
        track = player.queue.get()
        player.suppress_now_playing = True
        await player.play(track)
        
        await interaction.response.send_message(f"⏭️ Jumped to **{track.title}**")
    
    @app_commands.command(name="skipto", description="Skip to a specific track (alias for /jump)")
    @app_commands.describe(position="Position to skip to")
    async def skipto(self, interaction: discord.Interaction, position: app_commands.Range[int, 2, 1000]):
        """Alias for jump command."""
        await self.jump.callback(self, interaction, position)


async def setup(bot: commands.Bot):
    await bot.add_cog(Queue(bot))
