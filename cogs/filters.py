"""
Filters cog - Audio filter commands
Handles equalizer, bass boost, nightcore, vaporwave, etc.
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import logging

logger = logging.getLogger('MusicBot.Filters')


class Filters(commands.Cog):
    """Audio filter commands using Lavalink's native filters."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    async def get_player(self, interaction: discord.Interaction) -> wavelink.Player | None:
        """Get player and validate."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return None
        
        return player
    
    @app_commands.command(name="filters", description="Apply audio filters to the playback")
    @app_commands.describe(filter="Filter to apply")
    @app_commands.choices(filter=[
        app_commands.Choice(name="🔇 Clear All Filters", value="clear"),
        app_commands.Choice(name="🎸 Bass Boost", value="bassboost"),
        app_commands.Choice(name="🐿️ Nightcore", value="nightcore"),
        app_commands.Choice(name="🌀 Vaporwave", value="vaporwave"),
        app_commands.Choice(name="🎵 Karaoke", value="karaoke"),
        app_commands.Choice(name="🔊 8D Audio", value="8d"),
        app_commands.Choice(name="🎺 Treble Boost", value="treble"),
        app_commands.Choice(name="🐢 Slow", value="slow"),
        app_commands.Choice(name="⚡ Speed Up", value="fast"),
        app_commands.Choice(name="📻 Lo-Fi", value="lofi"),
        app_commands.Choice(name="🌊 Vibrato", value="vibrato"),
        app_commands.Choice(name="📢 Loud", value="loud"),
    ])
    async def filters(self, interaction: discord.Interaction, filter: str):
        """Apply or remove audio filters."""
        player = await self.get_player(interaction)
        if not player:
            return
        
        await interaction.response.defer()
        
        filters = player.filters
        
        if filter == "clear":
            filters.reset()
            await player.set_filters(filters)
            await interaction.followup.send("🔇 All filters cleared.")
            return
        
        # Define filter presets
        if filter == "bassboost":
            filters.equalizer.set(bands=[
                {"band": 0, "gain": 0.6},
                {"band": 1, "gain": 0.5},
                {"band": 2, "gain": 0.4},
                {"band": 3, "gain": 0.25},
                {"band": 4, "gain": 0.15},
            ])
            msg = "🎸 **Bass Boost** enabled"
            
        elif filter == "nightcore":
            filters.timescale.set(pitch=1.25, speed=1.25, rate=1.0)
            msg = "🐿️ **Nightcore** enabled"
            
        elif filter == "vaporwave":
            filters.timescale.set(pitch=0.8, speed=0.85, rate=1.0)
            filters.equalizer.set(bands=[
                {"band": 0, "gain": 0.3},
                {"band": 1, "gain": 0.3},
            ])
            msg = "🌀 **Vaporwave** enabled"
            
        elif filter == "karaoke":
            filters.karaoke.set(level=1.0, mono_level=1.0, filter_band=220.0, filter_width=100.0)
            msg = "🎵 **Karaoke** enabled (reduces vocals)"
            
        elif filter == "8d":
            filters.rotation.set(rotation_hz=0.2)
            msg = "🔊 **8D Audio** enabled"
            
        elif filter == "treble":
            filters.equalizer.set(bands=[
                {"band": 10, "gain": 0.4},
                {"band": 11, "gain": 0.45},
                {"band": 12, "gain": 0.5},
                {"band": 13, "gain": 0.55},
                {"band": 14, "gain": 0.6},
            ])
            msg = "🎺 **Treble Boost** enabled"
            
        elif filter == "slow":
            filters.timescale.set(speed=0.75, pitch=1.0, rate=1.0)
            msg = "🐢 **Slow** mode enabled"
            
        elif filter == "fast":
            filters.timescale.set(speed=1.5, pitch=1.0, rate=1.0)
            msg = "⚡ **Speed Up** enabled"
            
        elif filter == "lofi":
            filters.equalizer.set(bands=[
                {"band": 0, "gain": 0.2},
                {"band": 1, "gain": 0.15},
                {"band": 2, "gain": -0.1},
                {"band": 8, "gain": -0.15},
                {"band": 9, "gain": -0.2},
            ])
            filters.timescale.set(speed=0.95, pitch=0.95, rate=1.0)
            msg = "📻 **Lo-Fi** enabled"
            
        elif filter == "vibrato":
            filters.vibrato.set(frequency=4.0, depth=0.75)
            msg = "🌊 **Vibrato** enabled"
            
        elif filter == "loud":
            filters.equalizer.set(bands=[
                {"band": 0, "gain": 0.4},
                {"band": 1, "gain": 0.35},
                {"band": 5, "gain": 0.25},
                {"band": 10, "gain": 0.3},
                {"band": 11, "gain": 0.35},
            ])
            msg = "📢 **Loud** enabled"
        else:
            await interaction.followup.send("Unknown filter.", ephemeral=True)
            return
        
        await player.set_filters(filters)
        await interaction.followup.send(msg)
    
    @app_commands.command(name="equalizer", description="Set custom equalizer bands")
    @app_commands.describe(
        preset="Preset equalizer or custom",
    )
    @app_commands.choices(preset=[
        app_commands.Choice(name="Flat (Reset)", value="flat"),
        app_commands.Choice(name="Bass Heavy", value="bass"),
        app_commands.Choice(name="Piano", value="piano"),
        app_commands.Choice(name="Metal", value="metal"),
        app_commands.Choice(name="Pop", value="pop"),
        app_commands.Choice(name="Rock", value="rock"),
    ])
    async def equalizer(self, interaction: discord.Interaction, preset: str):
        """Apply equalizer presets."""
        player = await self.get_player(interaction)
        if not player:
            return
        
        filters = player.filters
        
        presets = {
            "flat": [],  # Reset
            "bass": [
                {"band": 0, "gain": 0.6}, {"band": 1, "gain": 0.5},
                {"band": 2, "gain": 0.35}, {"band": 3, "gain": 0.2},
            ],
            "piano": [
                {"band": 0, "gain": -0.25}, {"band": 1, "gain": -0.25},
                {"band": 2, "gain": -0.125}, {"band": 4, "gain": 0.25},
                {"band": 5, "gain": 0.25}, {"band": 7, "gain": -0.25},
                {"band": 8, "gain": -0.25}, {"band": 11, "gain": 0.5},
            ],
            "metal": [
                {"band": 0, "gain": 0.3}, {"band": 1, "gain": 0.25},
                {"band": 2, "gain": 0.2}, {"band": 3, "gain": 0.1},
                {"band": 8, "gain": 0.2}, {"band": 9, "gain": 0.25},
                {"band": 10, "gain": 0.3}, {"band": 11, "gain": 0.35},
            ],
            "pop": [
                {"band": 0, "gain": -0.15}, {"band": 1, "gain": 0.1},
                {"band": 5, "gain": 0.2}, {"band": 6, "gain": 0.15},
                {"band": 8, "gain": -0.1}, {"band": 10, "gain": -0.15},
            ],
            "rock": [
                {"band": 0, "gain": 0.3}, {"band": 1, "gain": 0.25},
                {"band": 3, "gain": -0.15}, {"band": 4, "gain": -0.1},
                {"band": 8, "gain": 0.2}, {"band": 10, "gain": 0.3},
                {"band": 11, "gain": 0.35},
            ],
        }
        
        bands = presets.get(preset, [])
        
        if preset == "flat":
            filters.equalizer.reset()
        else:
            filters.equalizer.set(bands=bands)
        
        await player.set_filters(filters)
        await interaction.response.send_message(f"🎛️ Equalizer set to **{preset.title()}**")
    
    @app_commands.command(name="clearfilter", description="Clear all audio filters")
    async def clearfilter(self, interaction: discord.Interaction):
        """Clear all active filters."""
        player = await self.get_player(interaction)
        if not player:
            return
        
        filters = player.filters
        filters.reset()
        await player.set_filters(filters)
        
        # Clear active filters tracking
        if hasattr(player, 'active_filters'):
            player.active_filters.clear()
        
        await interaction.response.send_message("🔇 Cleared all filters!")
    
    @app_commands.command(name="speed", description="Set playback speed")
    @app_commands.describe(speed="Speed multiplier (0.5 to 2.0)")
    async def speed(self, interaction: discord.Interaction, speed: app_commands.Range[float, 0.5, 2.0]):
        """Set playback speed."""
        player = await self.get_player(interaction)
        if not player:
            return
        
        filters = player.filters
        filters.timescale.set(speed=speed)
        await player.set_filters(filters)
        
        await interaction.response.send_message(f"⏩ Set playback speed to **{speed}x**")
    
    @app_commands.command(name="pitch", description="Set audio pitch")
    @app_commands.describe(pitch="Pitch multiplier (0.5 to 2.0)")
    async def pitch(self, interaction: discord.Interaction, pitch: app_commands.Range[float, 0.5, 2.0]):
        """Set audio pitch."""
        player = await self.get_player(interaction)
        if not player:
            return
        
        filters = player.filters
        filters.timescale.set(pitch=pitch)
        await player.set_filters(filters)
        
        await interaction.response.send_message(f"🎵 Set pitch to **{pitch}x**")


async def setup(bot: commands.Bot):
    await bot.add_cog(Filters(bot))
