"""
Discord Music Bot - Python + Lavalink
High-performance music bot using wavelink and Lavalink v4
"""

import os
import asyncio
import logging
from dotenv import load_dotenv

import discord
from discord.ext import commands

import wavelink

# Load environment variables
load_dotenv()

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)-8s | %(name)-20s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger('MusicBot')

# Bot configuration
BOT_TOKEN = os.getenv('BOT_TOKEN')
LAVALINK_URI = os.getenv('LAVALINK_URI', 'http://localhost:2333')
LAVALINK_PASSWORD = os.getenv('LAVALINK_PASSWORD', 'youshallnotpass')
IDLE_TIMEOUT = int(os.getenv('IDLE_TIMEOUT', '120'))  # seconds
ALONE_TIMEOUT = int(os.getenv('ALONE_TIMEOUT', '60'))  # seconds


class MusicBot(commands.Bot):
    """Main bot class with Lavalink integration."""
    
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.voice_states = True
        
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="music | /help"
            )
        )
        
        # Song in status tracking
        self.song_in_status = False
        
        # Timeout tasks for auto-disconnect
        self.timeout_tasks: dict[int, asyncio.Task] = {}
    
    async def setup_hook(self):
        """Initialize Lavalink connection and load cogs."""
        # Connect to Lavalink
        node = wavelink.Node(
            uri=LAVALINK_URI,
            password=LAVALINK_PASSWORD,
        )
        await wavelink.Pool.connect(nodes=[node], client=self, cache_capacity=100)
        logger.info(f"Connected to Lavalink at {LAVALINK_URI}")
        
        # Load cogs
        await self.load_extension('cogs.music')
        await self.load_extension('cogs.queue')
        await self.load_extension('cogs.filters')
        await self.load_extension('cogs.playlists')
        await self.load_extension('cogs.utility')
        await self.load_extension('cogs.admin')
        await self.load_extension('cogs.owner')
        await self.load_extension('cogs.lyrics')
        logger.info("Loaded all cogs")
        
        # Sync slash commands
        await self.tree.sync()
        logger.info("Synced slash commands")
    
    async def on_ready(self):
        logger.info(f"Bot ready: {self.user} (ID: {self.user.id})")
        logger.info(f"Connected to {len(self.guilds)} guilds")
    
    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload):
        logger.info(f"Lavalink node ready: {payload.node.identifier} | Resumed: {payload.resumed}")
    
    async def on_wavelink_track_start(self, payload: wavelink.TrackStartEventPayload):
        player = payload.player
        track = payload.track
        
        # Clear vote skips
        if hasattr(player, 'skip_votes'):
            player.skip_votes.clear()
        
        # Update status if song-in-status enabled
        if self.song_in_status:
            await self.change_presence(activity=discord.Activity(
                type=discord.ActivityType.listening,
                name=track.title[:128]
            ))
        
        # Cancel any disconnect timeout
        self.clear_timeout(player.guild.id)
        
        if player.channel:
            embed = discord.Embed(
                title="🎵 Now Playing",
                description=f"**[{track.title}]({track.uri})**",
                color=discord.Color.blurple()
            )
            embed.add_field(name="Duration", value=format_duration(track.length), inline=True)
            embed.add_field(name="Author", value=track.author, inline=True)
            
            if track.artwork:
                embed.set_thumbnail(url=track.artwork)
            
            # Get the text channel from player context
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send(embed=embed)
                except:
                    pass
    
    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload):
        player = payload.player
        
        # Clear vote skips
        if hasattr(player, 'skip_votes'):
            player.skip_votes.clear()
        
        # Reset status if queue empty and song-in-status enabled
        if self.song_in_status and not player.queue:
            await self.change_presence(activity=discord.Activity(
                type=discord.ActivityType.listening,
                name="music | /help"
            ))
        
        # Start idle timeout if queue is empty
        if not player.queue:
            self.start_idle_timeout(player)
    
    async def on_voice_state_update(self, member: discord.Member, before: discord.VoiceState, after: discord.VoiceState):
        """Handle auto-disconnect when bot is alone."""
        # Ignore if it's the bot itself
        if member.id == self.user.id:
            return
        
        player = member.guild.voice_client
        if not player or not isinstance(player, wavelink.Player):
            return
        
        # Check if the update is related to bot's channel
        if before.channel != player.channel and after.channel != player.channel:
            return
        
        # Count non-bot members in bot's channel
        members = [m for m in player.channel.members if not m.bot]
        
        if len(members) == 0:
            # Bot is alone, start timeout
            self.start_alone_timeout(player)
        else:
            # Someone joined, cancel timeout
            self.clear_timeout(member.guild.id)
    
    def start_idle_timeout(self, player: wavelink.Player):
        """Start timeout when queue is empty."""
        from services.storage import server_settings
        
        if server_settings.get_setting(player.guild.id, 'stay_in_channel'):
            return  # 24/7 mode enabled
        
        if IDLE_TIMEOUT <= 0:
            return
        
        self.clear_timeout(player.guild.id)
        
        async def disconnect():
            await asyncio.sleep(IDLE_TIMEOUT)
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send("⏹️ Disconnected due to inactivity.")
                except:
                    pass
            await player.disconnect()
        
        self.timeout_tasks[player.guild.id] = asyncio.create_task(disconnect())
    
    def start_alone_timeout(self, player: wavelink.Player):
        """Start timeout when bot is alone."""
        from services.storage import server_settings
        
        if server_settings.get_setting(player.guild.id, 'stay_in_channel'):
            return  # 24/7 mode enabled
        
        if ALONE_TIMEOUT <= 0:
            return
        
        self.clear_timeout(player.guild.id)
        
        async def disconnect():
            await asyncio.sleep(ALONE_TIMEOUT)
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send("⏹️ Disconnected - no one else in the channel.")
                except:
                    pass
            await player.disconnect()
        
        self.timeout_tasks[player.guild.id] = asyncio.create_task(disconnect())
    
    def clear_timeout(self, guild_id: int):
        """Cancel any pending timeout for a guild."""
        if guild_id in self.timeout_tasks:
            self.timeout_tasks[guild_id].cancel()
            del self.timeout_tasks[guild_id]
    
    async def on_wavelink_inactive_player(self, player: wavelink.Player):
        """Called when player has been inactive for too long."""
        await player.disconnect()
        if hasattr(player, 'text_channel') and player.text_channel:
            try:
                await player.text_channel.send("⏹️ Disconnected due to inactivity.")
            except:
                pass


def format_duration(ms: int) -> str:
    """Format milliseconds to mm:ss or hh:mm:ss."""
    seconds = ms // 1000
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


async def main():
    if not BOT_TOKEN:
        logger.error("BOT_TOKEN not set in environment variables!")
        return
    
    bot = MusicBot()
    
    async with bot:
        await bot.start(BOT_TOKEN)


if __name__ == '__main__':
    asyncio.run(main())
