"""
Utility cog - Help and utility commands
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import logging

logger = logging.getLogger('MusicBot.Utility')


class Utility(commands.Cog):
    """Utility commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="help", description="Show help for available commands")
    async def help(self, interaction: discord.Interaction):
        """Display help embed."""
        embed = discord.Embed(
            title="🎵 Music Bot Commands",
            color=discord.Color.blurple()
        )
        
        embed.add_field(
            name="🎶 Playing Music",
            value="`/play` - Play from URL or search\n"
                  "`/pause` `/resume` `/stop`\n"
                  "`/seek` - Jump to timestamp\n"
                  "`/replay` - Restart song",
            inline=True
        )
        
        embed.add_field(
            name="⏭️ Skipping",
            value="`/skip` - Skip current\n"
                  "`/voteskip` - Vote to skip\n"
                  "`/previous` - Previous track\n"
                  "`/jump` - Jump to position",
            inline=True
        )
        
        embed.add_field(
            name="📋 Queue",
            value="`/queue` - View queue\n"
                  "`/nowplaying` - Now playing\n"
                  "`/shuffle` `/clear`\n"
                  "`/remove` `/move`",
            inline=True
        )
        
        embed.add_field(
            name="🎛️ Audio",
            value="`/volume` - Set volume\n"
                  "`/filters` - Audio effects\n"
                  "`/equalizer` - EQ presets\n"
                  "`/speed` `/pitch`",
            inline=True
        )
        
        embed.add_field(
            name="💾 Playlists",
            value="`/savelist` - Save queue\n"
                  "`/loadlist` - Load playlist\n"
                  "`/playlists` - Your lists\n"
                  "`/deletelist` `/appendlist`",
            inline=True
        )
        
        embed.add_field(
            name="⚙️ Settings",
            value="`/loop` - Toggle loop\n"
                  "`/autoplay` - Auto-queue\n"
                  "`/ping` - Bot latency\n"
                  "`/stats` - Bot stats",
            inline=True
        )
        
        embed.set_footer(
            text="Supports YouTube, Spotify, SoundCloud & more!"
        )
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="ping", description="Check bot latency")
    async def ping(self, interaction: discord.Interaction):
        """Show bot and Lavalink latency."""
        # Discord latency
        bot_latency = round(self.bot.latency * 1000)
        
        # Lavalink latency
        nodes = wavelink.Pool.nodes
        lavalink_latency = "N/A"
        if nodes:
            node = list(nodes.values())[0]
            # Node heartbeat is typically in ms
            lavalink_latency = f"{node.heartbeat}ms" if node.heartbeat else "N/A"
        
        embed = discord.Embed(
            title="🏓 Pong!",
            color=discord.Color.green()
        )
        embed.add_field(name="Bot Latency", value=f"{bot_latency}ms", inline=True)
        embed.add_field(name="Lavalink", value=lavalink_latency, inline=True)
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="stats", description="Show bot statistics")
    async def stats(self, interaction: discord.Interaction):
        """Display bot statistics."""
        # Count active players
        active_players = sum(1 for g in self.bot.guilds if g.voice_client)
        
        # Lavalink stats
        nodes = wavelink.Pool.nodes
        lavalink_info = "Not connected"
        if nodes:
            node = list(nodes.values())[0]
            lavalink_info = f"Connected ({node.identifier})"
        
        embed = discord.Embed(
            title="📊 Bot Statistics",
            color=discord.Color.blurple()
        )
        
        embed.add_field(name="Servers", value=str(len(self.bot.guilds)), inline=True)
        embed.add_field(name="Active Players", value=str(active_players), inline=True)
        embed.add_field(name="Lavalink", value=lavalink_info, inline=True)
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="disconnect", description="Disconnect from voice channel")
    async def disconnect(self, interaction: discord.Interaction):
        """Disconnect the bot from voice."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            await interaction.response.send_message("Not connected to voice.", ephemeral=True)
            return
        
        await player.disconnect()
        await interaction.response.send_message("👋 Disconnected.")


async def setup(bot: commands.Bot):
    await bot.add_cog(Utility(bot))
