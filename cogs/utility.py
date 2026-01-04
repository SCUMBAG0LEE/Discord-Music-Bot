"""
Utility cog - Help and utility commands
Mirrors JS utility.js with detailed help categories
"""

import discord
from discord import app_commands
from discord.ext import commands

import wavelink
from typing import cast
import logging
import os
import platform

logger = logging.getLogger('MusicBot.Utility')


def format_duration(ms: int) -> str:
    """Format milliseconds to mm:ss or hh:mm:ss."""
    seconds = ms // 1000
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


class Utility(commands.Cog):
    """Utility commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="help", description="Show all available commands")
    async def help(self, interaction: discord.Interaction):
        """Display detailed help embed - mirrors JS utility.js help."""
        embed = discord.Embed(
            title="🎵 Music Bot Commands",
            color=discord.Color.from_str('#5865F2'),
            description="A Discord music bot powered by Lavalink"
        )
        
        embed.add_field(
            name="🎶 Playback",
            value="\n".join([
                "`/play` - Play a song or playlist",
                "`/search` - Search with selection",
                "`/playnext` - Add song to play next",
                "`/pause` - Pause playback",
                "`/resume` - Resume playback",
                "`/stop` - Stop and disconnect",
                "`/skip` - Skip current track",
                "`/forceskip` - Force skip (DJ)",
                "`/voteskip` - Vote to skip",
                "`/forceplay` - Play immediately (DJ)",
                "`/previous` - Play previous track",
                "`/seek` - Seek to position",
                "`/volume` - Adjust volume",
                "`/nowplaying` - Show current track",
                "`/loop` - Toggle loop mode",
                "`/replay` - Replay current track",
                "`/lyrics` - Get song lyrics"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="📋 Queue",
            value="\n".join([
                "`/queue` - Show the queue",
                "`/shuffle` - Shuffle the queue",
                "`/clear` - Clear the queue",
                "`/remove` - Remove a track",
                "`/forceremove` - Force remove (DJ)",
                "`/move` - Move a track",
                "`/jump` - Jump to a track",
                "`/skipto` - Skip to a track"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="💾 Playlists",
            value="\n".join([
                "`/playlists` - View saved playlists",
                "`/savelist` - Save queue as playlist",
                "`/loadlist` - Load a playlist",
                "`/appendlist` - Add to playlist",
                "`/deletelist` - Delete a playlist"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="🎛️ Filters",
            value="\n".join([
                "`/filters` - Apply audio filter",
                "`/equalizer` - Equalizer presets",
                "`/speed` - Adjust playback speed",
                "`/pitch` - Adjust audio pitch"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="⚙️ Settings",
            value="\n".join([
                "`/loop` - Toggle loop mode",
                "`/autoplay` - Toggle autoplay",
                "`/247` - Toggle 24/7 mode",
                "`/djrole` - Set DJ role (Admin)",
                "`/serversettings` - View all settings"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="🔧 Admin (Requires Admin/Owner)",
            value="\n".join([
                "`/settc` - Lock bot to text channel",
                "`/setvc` - Lock bot to voice channel",
                "`/queuetype` - Linear or fair queue",
                "`/skipratio` - Vote skip threshold",
                "`/autoplaylist` - Auto-load playlist",
                "`/songinstatus` - Show song in status"
            ]),
            inline=False
        )
        
        embed.add_field(
            name="🔧 Utility",
            value="\n".join([
                "`/help` - Show this message",
                "`/ping` - Check bot latency",
                "`/stats` - Bot statistics"
            ]),
            inline=False
        )
        
        embed.set_footer(text="Powered by Lavalink | DJ commands require DJ role")
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="ping", description="Check bot and Lavalink latency")
    async def ping(self, interaction: discord.Interaction):
        """Show bot and Lavalink latency - mirrors JS utility.js ping."""
        await interaction.response.defer()
        
        # Discord latency
        bot_latency = round(self.bot.latency * 1000)
        
        # Lavalink latency
        nodes = wavelink.Pool.nodes
        lavalink_ping = "N/A"
        if nodes:
            node = list(nodes.values())[0]
            if node.heartbeat:
                lavalink_ping = f"{node.heartbeat}ms"
        
        embed = discord.Embed(
            title="🏓 Pong!",
            color=discord.Color.green()
        )
        embed.add_field(name="Bot Latency", value=f"{bot_latency}ms", inline=True)
        embed.add_field(name="WebSocket", value=f"{round(self.bot.latency * 1000)}ms", inline=True)
        embed.add_field(name="Lavalink", value=lavalink_ping, inline=True)
        
        await interaction.followup.send(embed=embed)
    
    @app_commands.command(name="stats", description="Show bot statistics")
    async def stats(self, interaction: discord.Interaction):
        """Display bot statistics - mirrors JS utility.js stats."""
        import psutil
        import time
        
        # Bot stats
        uptime_seconds = int(time.time() - psutil.Process().create_time())
        uptime = format_duration(uptime_seconds * 1000)
        
        # Memory
        process = psutil.Process()
        mem_usage = process.memory_info().rss / 1024 / 1024
        
        guilds = len(self.bot.guilds)
        active_players = sum(1 for g in self.bot.guilds if g.voice_client)
        
        embed = discord.Embed(
            title="📊 Bot Statistics",
            color=discord.Color.from_str('#5865F2')
        )
        
        embed.add_field(name="⏱️ Uptime", value=uptime, inline=True)
        embed.add_field(name="💾 Memory", value=f"{mem_usage:.2f} MB", inline=True)
        embed.add_field(name="🏠 Servers", value=str(guilds), inline=True)
        embed.add_field(name="🎵 Active Players", value=str(active_players), inline=True)
        embed.add_field(name="📡 Python", value=platform.python_version(), inline=True)
        embed.add_field(name="💻 Platform", value=f"{platform.system()} {platform.machine()}", inline=True)
        
        # Lavalink stats if available
        nodes = wavelink.Pool.nodes
        if nodes:
            node = list(nodes.values())[0]
            embed.add_field(name="\u200B", value="**Lavalink Node**", inline=False)
            embed.add_field(name="Node", value=node.identifier, inline=True)
            embed.add_field(name="Status", value="🟢 Connected" if node.status.is_connected else "🔴 Disconnected", inline=True)
            
            if hasattr(node, 'stats') and node.stats:
                stats = node.stats
                embed.add_field(name="Players", value=str(stats.players), inline=True)
                embed.add_field(name="Playing", value=str(stats.playing_players), inline=True)
        
        await interaction.response.send_message(embed=embed)
    
    @app_commands.command(name="disconnect", description="Disconnect from voice channel")
    async def disconnect(self, interaction: discord.Interaction):
        """Disconnect the bot from voice."""
        player = cast(wavelink.Player, interaction.guild.voice_client)
        
        if not player:
            return await interaction.response.send_message("Not connected to voice.", ephemeral=True)
        
        await player.disconnect()
        await interaction.response.send_message("👋 Disconnected.")


async def setup(bot: commands.Bot):
    await bot.add_cog(Utility(bot))
