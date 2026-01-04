"""
Discord Music Bot - Python + Lavalink
High-performance music bot using wavelink and Lavalink v4
Structured to mirror the JavaScript version for feature parity.
"""

import os
import asyncio
import logging
from dotenv import load_dotenv

import discord
from discord import ActivityType
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


class Config:
    """Bot configuration from environment variables."""
    token: str = os.getenv('BOT_TOKEN', '')
    client_id: str = os.getenv('CLIENT_ID', '')
    guild_id: str = os.getenv('GUILD_ID', '')
    owner_id: str = os.getenv('OWNER_ID', '')
    dj_role_id: str = os.getenv('DJ_ROLE_ID', '')
    
    # Lavalink configuration
    lavalink_host: str = os.getenv('LAVALINK_HOST', 'localhost:2333')
    lavalink_password: str = os.getenv('LAVALINK_PASSWORD', 'youshallnotpass')
    lavalink_secure: bool = os.getenv('LAVALINK_SECURE', 'false').lower() == 'true'
    
    @property
    def lavalink_uri(self) -> str:
        """Build Lavalink URI from host and secure settings."""
        protocol = 'https' if self.lavalink_secure else 'http'
        return f"{protocol}://{self.lavalink_host}"
    
    # Bot settings
    default_volume: int = int(os.getenv('DEFAULT_VOLUME', '100'))
    max_queue_size: int = int(os.getenv('MAX_QUEUE_SIZE', '0'))  # 0 = unlimited
    max_duration: int = int(os.getenv('MAX_DURATION', '0'))  # 0 = unlimited (in seconds)
    skip_ratio: float = float(os.getenv('SKIP_RATIO', '0.5'))
    
    # Activity/Status
    activity_type: str = os.getenv('BOT_ACTIVITY_TYPE', 'LISTENING')
    activity_name: str = os.getenv('BOT_ACTIVITY_NAME', 'music | /help')
    status: str = os.getenv('BOT_STATUS', 'online')
    
    # Auto-disconnect settings
    alone_time: int = int(os.getenv('ALONE_TIME', '60'))
    idle_time: int = int(os.getenv('IDLE_TIME', '120'))
    stay_in_channel: bool = os.getenv('STAY_IN_CHANNEL', 'false').lower() == 'true'
    
    # Display settings
    np_images: bool = os.getenv('NP_IMAGES', 'true').lower() == 'true'


config = Config()


# Import shared utilities
from services.utils import format_duration


def get_activity_type(type_str: str) -> ActivityType:
    """Convert string to ActivityType."""
    types = {
        'PLAYING': ActivityType.playing,
        'LISTENING': ActivityType.listening,
        'WATCHING': ActivityType.watching,
        'COMPETING': ActivityType.competing,
    }
    return types.get(type_str.upper(), ActivityType.listening)


class MusicBot(commands.Bot):
    """Main bot class with Lavalink integration."""
    
    def __init__(self):
        import time
        
        intents = discord.Intents.default()
        intents.message_content = True
        intents.voice_states = True
        
        super().__init__(
            command_prefix=commands.when_mentioned,
            intents=intents,
            activity=discord.Activity(
                type=get_activity_type(config.activity_type),
                name=config.activity_name
            )
        )
        
        # Store config on bot for access from cogs
        self.config = config
        
        # Track bot start time for uptime
        self.start_time = time.time()
        
        # Song in status tracking (can be toggled globally)
        self.song_in_status = False
        
        # Timeout tasks for auto-disconnect
        self.timeout_tasks: dict[int, asyncio.Task] = {}
    
    async def setup_hook(self):
        """Initialize Lavalink connection and load cogs."""
        # Connect to Lavalink
        node = wavelink.Node(
            uri=config.lavalink_uri,
            password=config.lavalink_password,
        )
        await wavelink.Pool.connect(nodes=[node], client=self, cache_capacity=100)
        logger.info(f"Connected to Lavalink at {config.lavalink_uri}")
        
        # Load cogs
        cogs = ['music', 'queue', 'filters', 'playlists', 'utility', 'admin', 'owner', 'lyrics']
        for cog in cogs:
            try:
                await self.load_extension(f'cogs.{cog}')
                logger.info(f"  ✓ Loaded cog: {cog}")
            except Exception as e:
                logger.error(f"  ✗ Failed to load {cog}: {e}")
        
        # Sync slash commands
        await self.tree.sync()
        logger.info("✓ Synced slash commands")
        
        # Add global interaction check for text channel lock
        @self.tree.interaction_check
        async def global_interaction_check(interaction: discord.Interaction) -> bool:
            """Check if bot can respond in this text channel."""
            if not interaction.guild_id:
                return True  # DMs always allowed
            
            # Skip check for bot owner
            if str(interaction.user.id) == config.owner_id:
                return True
            
            from services.storage import server_settings
            if not server_settings.can_use_text_channel(interaction.guild_id, interaction.channel_id):
                settings = server_settings.get_settings(interaction.guild_id)
                await interaction.response.send_message(
                    f"❌ Bot commands are restricted to <#{settings['text_channel_id']}>",
                    ephemeral=True
                )
                return False
            return True
    
    async def on_ready(self):
        logger.info(f"🤖 Logged in as {self.user} (ID: {self.user.id})")
        logger.info(f"Connected to {len(self.guilds)} guilds")
        logger.info("✓ Bot is ready!")
        
        # Set initial presence
        await self.change_presence(
            activity=discord.Activity(
                type=get_activity_type(config.activity_type),
                name=config.activity_name
            ),
            status=discord.Status[config.status] if config.status in ['online', 'idle', 'dnd', 'invisible'] else discord.Status.online
        )
    
    async def on_wavelink_node_ready(self, payload: wavelink.NodeReadyEventPayload):
        logger.info(f"✓ Lavalink node ready: {payload.node.identifier} | Resumed: {payload.resumed}")
        # Cancel any pending reconnect task
        if hasattr(self, '_reconnect_task') and self._reconnect_task:
            self._reconnect_task.cancel()
            self._reconnect_task = None
    
    async def on_wavelink_node_closed(self, node: wavelink.Node, disconnected: list):
        """Handle node disconnection with automatic reconnect."""
        logger.warning(f"⚠️ Lavalink node disconnected: {node.identifier}")
        
        # Start reconnection loop
        if not hasattr(self, '_reconnect_task') or not self._reconnect_task:
            self._reconnect_task = asyncio.create_task(self._reconnect_node())
    
    async def _reconnect_node(self):
        """Attempt to reconnect to Lavalink every 5 seconds."""
        while True:
            try:
                await asyncio.sleep(5)
                logger.info("Attempting to reconnect to Lavalink...")
                
                # Check if already connected
                nodes = wavelink.Pool.nodes
                if nodes and any(n.status.is_connected for n in nodes.values()):
                    logger.info("✓ Lavalink node already connected")
                    break
                
                # Try to reconnect
                node = wavelink.Node(
                    uri=config.lavalink_uri,
                    password=config.lavalink_password,
                )
                await wavelink.Pool.connect(nodes=[node], client=self, cache_capacity=100)
                logger.info("✓ Reconnected to Lavalink!")
                break
            except Exception as e:
                logger.warning(f"Reconnect failed, retrying in 5s... ({e})")
        
        self._reconnect_task = None
    
    async def on_wavelink_track_start(self, payload: wavelink.TrackStartEventPayload):
        """Called when a track starts playing."""
        player = payload.player
        track = payload.track
        
        # Clear any disconnect timeout
        self.clear_timeout(player.guild.id)
        
        # Clear vote skips for new track
        if hasattr(player, 'skip_votes'):
            player.skip_votes.clear()
        
        # Update status if song-in-status enabled
        from services.storage import server_settings
        guild_settings = server_settings.get_settings(player.guild.id)
        
        if self.song_in_status or guild_settings.get('song_in_status'):
            await self.change_presence(activity=discord.Activity(
                type=ActivityType.listening,
                name=track.title[:128]
            ))
        
        # Check if this track was started by a command (to avoid duplicate message)
        # Commands set player.suppress_now_playing = True before calling play()
        if getattr(player, 'suppress_now_playing', False):
            player.suppress_now_playing = False
            return
        
        # Send now playing message for automatic queue progression
        if hasattr(player, 'text_channel') and player.text_channel:
            try:
                embed = discord.Embed(
                    title="🎵 Now Playing",
                    description=f"**[{track.title}]({track.uri})**",
                    color=discord.Color.blurple()
                )
                embed.add_field(name="Duration", value=format_duration(track.length), inline=True)
                embed.add_field(name="Author", value=track.author, inline=True)
                
                if hasattr(track, 'requester') and track.requester:
                    embed.add_field(name="Requested by", value=track.requester.mention, inline=True)
                
                # Only show thumbnail if np_images is enabled (default: True)
                if config.np_images and track.artwork:
                    embed.set_thumbnail(url=track.artwork)
                
                await player.text_channel.send(embed=embed)
            except Exception as e:
                logger.warning(f"Failed to send now playing message: {e}")
    
    async def on_wavelink_track_end(self, payload: wavelink.TrackEndEventPayload):
        """Called when a track ends."""
        player = payload.player
        
        # Clear vote skips
        if hasattr(player, 'skip_votes'):
            player.skip_votes.clear()
        
        # Check if queue is empty
        if not player.queue:
            # Reset status if song-in-status was enabled
            from services.storage import server_settings
            guild_settings = server_settings.get_settings(player.guild.id)
            
            if self.song_in_status or guild_settings.get('song_in_status'):
                await self.change_presence(activity=discord.Activity(
                    type=get_activity_type(config.activity_type),
                    name=config.activity_name
                ))
            
            # Send queue finished message
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send("✅ Queue finished! Use `/play` to add more songs.")
                except:
                    pass
            
            # Start idle timeout
            self.start_idle_timeout(player)
    
    async def on_wavelink_inactive_player(self, player: wavelink.Player):
        """Called when player has been inactive."""
        if hasattr(player, 'text_channel') and player.text_channel:
            try:
                await player.text_channel.send("⏹️ Disconnected due to inactivity.")
            except:
                pass
        await player.disconnect()
    
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
        
        if server_settings.get_setting(player.guild.id, 'stay_in_channel') or config.stay_in_channel:
            return  # 24/7 mode enabled
        
        if config.idle_time <= 0:
            return
        
        self.clear_timeout(player.guild.id)
        
        async def disconnect():
            await asyncio.sleep(config.idle_time)
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send("⏹️ Disconnected due to inactivity.")
                except:
                    pass
            try:
                await player.disconnect()
            except:
                pass
        
        self.timeout_tasks[player.guild.id] = asyncio.create_task(disconnect())
    
    def start_alone_timeout(self, player: wavelink.Player):
        """Start timeout when bot is alone."""
        from services.storage import server_settings
        
        if server_settings.get_setting(player.guild.id, 'stay_in_channel') or config.stay_in_channel:
            return  # 24/7 mode enabled
        
        if config.alone_time <= 0:
            return
        
        self.clear_timeout(player.guild.id)
        
        async def disconnect():
            await asyncio.sleep(config.alone_time)
            if hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send("⏹️ Disconnected - no one else in the channel.")
                except:
                    pass
            try:
                await player.disconnect()
            except:
                pass
        
        self.timeout_tasks[player.guild.id] = asyncio.create_task(disconnect())
    
    def clear_timeout(self, guild_id: int):
        """Cancel any pending timeout for a guild."""
        if guild_id in self.timeout_tasks:
            self.timeout_tasks[guild_id].cancel()
            del self.timeout_tasks[guild_id]
    
    async def load_autoplaylist(self, player: wavelink.Player, guild_id: int):
        """Load autoplaylist if configured for this guild."""
        from services.storage import server_settings, playlist_service
        
        settings = server_settings.get_settings(guild_id)
        auto_playlist = settings.get('auto_playlist')
        
        if not auto_playlist:
            return
        
        user_id = auto_playlist.get('user_id')
        name = auto_playlist.get('name')
        
        if not user_id or not name:
            return
        
        # Get playlist using PlaylistService
        playlist_data = playlist_service.get_playlist(user_id, name)
        
        if not playlist_data:
            return
        
        tracks = playlist_data.get('tracks', [])
        if not tracks:
            return
        
        try:
            logger.info(f"Loading autoplaylist '{name}' for guild {guild_id}")
            
            added = 0
            for track_data in tracks:
                try:
                    results = await wavelink.Playable.search(track_data.get("uri") or track_data.get("title", ""))
                    if results:
                        track = results[0] if not isinstance(results, wavelink.Playlist) else results.tracks[0]
                        await player.queue.put_wait(track)
                        added += 1
                except:
                    pass
            
            if added > 0 and hasattr(player, 'text_channel') and player.text_channel:
                try:
                    await player.text_channel.send(f"📂 Auto-loaded **{name}** playlist ({added} tracks)")
                except:
                    pass
                
                # Start playing if not already
                if not player.playing and player.queue:
                    await player.play(player.queue.get())
                    
        except Exception as e:
            logger.error(f"Failed to load autoplaylist: {e}")


async def main():
    if not config.token:
        logger.error("BOT_TOKEN not set in environment variables!")
        return
    
    logger.info("🎵 Discord Music Bot (Python + Lavalink) Starting...")
    
    bot = MusicBot()
    
    # Global error handler
    @bot.tree.error
    async def on_app_command_error(interaction: discord.Interaction, error: discord.app_commands.AppCommandError):
        """Global slash command error handler."""
        logger.error(f"Command error in /{interaction.command.name if interaction.command else 'unknown'}: {error}")
        
        error_message = "An error occurred while executing this command."
        if isinstance(error, discord.app_commands.CommandOnCooldown):
            error_message = f"Command on cooldown. Try again in {error.retry_after:.1f}s"
        elif isinstance(error, discord.app_commands.MissingPermissions):
            error_message = "You don't have permission to use this command."
        
        try:
            if interaction.response.is_done():
                await interaction.followup.send(error_message, ephemeral=True)
            else:
                await interaction.response.send_message(error_message, ephemeral=True)
        except:
            pass
    
    async with bot:
        await bot.start(config.token)


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped by user")
    except Exception as e:
        logger.error(f"Unhandled exception: {e}")
