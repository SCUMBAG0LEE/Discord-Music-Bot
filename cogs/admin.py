"""
Admin cog - Server configuration commands
settc, setvc, queuetype, skipratio, autoplaylist, songinstatus
"""

import discord
from discord import app_commands
from discord.ext import commands

from services.storage import server_settings
from services.utils import is_owner


class Admin(commands.Cog):
    """Admin commands for server configuration."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="settc", description="Set the text channel for bot commands (Admin only)")
    @app_commands.describe(channel="Text channel (leave empty to allow all)")
    async def settc(self, interaction: discord.Interaction, channel: discord.TextChannel = None):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message(
                "🔒 This command requires Administrator permission.", ephemeral=True
            )
        
        if channel:
            server_settings.set_setting(interaction.guild_id, 'text_channel_id', str(channel.id))
            await interaction.response.send_message(
                f"✅ Bot will only respond to commands in {channel.mention}."
            )
        else:
            server_settings.set_setting(interaction.guild_id, 'text_channel_id', None)
            await interaction.response.send_message("✅ Bot will respond to commands in any channel.")
    
    @app_commands.command(name="setvc", description="Set the voice channel for the bot (Admin only)")
    @app_commands.describe(channel="Voice channel (leave empty to allow all)")
    async def setvc(self, interaction: discord.Interaction, channel: discord.VoiceChannel = None):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message(
                "🔒 This command requires Administrator permission.", ephemeral=True
            )
        
        if channel:
            server_settings.set_setting(interaction.guild_id, 'voice_channel_id', str(channel.id))
            await interaction.response.send_message(f"✅ Bot will only join {channel.mention}.")
        else:
            server_settings.set_setting(interaction.guild_id, 'voice_channel_id', None)
            await interaction.response.send_message("✅ Bot can join any voice channel.")
    
    @app_commands.command(name="queuetype", description="Set the queue type (Admin only)")
    @app_commands.describe(queue_type="Queue type")
    @app_commands.choices(queue_type=[
        app_commands.Choice(name="Linear - Play in order added", value="linear"),
        app_commands.Choice(name="Fair - Alternate between users", value="fair"),
    ])
    async def queuetype(self, interaction: discord.Interaction, queue_type: str):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message(
                "🔒 This command requires Administrator permission.", ephemeral=True
            )
        
        server_settings.set_setting(interaction.guild_id, 'queue_type', queue_type)
        
        if queue_type == 'fair':
            desc = "🔄 **Fair Queue**: Bot will alternate between users."
        else:
            desc = "➡️ **Linear Queue**: Songs play in order added."
        
        await interaction.response.send_message(f"✅ Queue type set to **{queue_type}**\n\n{desc}")
    
    @app_commands.command(name="skipratio", description="Set the vote skip ratio (Admin only)")
    @app_commands.describe(ratio="Ratio of listeners needed to skip (0.0-1.0)")
    async def skipratio(
        self,
        interaction: discord.Interaction,
        ratio: app_commands.Range[float, 0.0, 1.0] = None
    ):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message(
                "🔒 This command requires Administrator permission.", ephemeral=True
            )
        
        if ratio is not None:
            server_settings.set_setting(interaction.guild_id, 'skip_ratio', ratio)
            await interaction.response.send_message(
                f"✅ Skip ratio set to **{int(ratio * 100)}%** of listeners needed to skip."
            )
        else:
            server_settings.set_setting(interaction.guild_id, 'skip_ratio', None)
            await interaction.response.send_message("✅ Skip ratio reset to global default (50%).")
    
    @app_commands.command(name="djrole", description="Set the DJ role (Admin only)")
    @app_commands.describe(role="DJ role (leave empty to disable)")
    async def djrole(self, interaction: discord.Interaction, role: discord.Role = None):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message(
                "🔒 This command requires Administrator permission.", ephemeral=True
            )
        
        if role:
            server_settings.set_setting(interaction.guild_id, 'dj_role_id', str(role.id))
            await interaction.response.send_message(f"✅ DJ role set to {role.mention}.")
        else:
            server_settings.set_setting(interaction.guild_id, 'dj_role_id', None)
            await interaction.response.send_message("✅ DJ role disabled. Anyone can use DJ commands.")
    
    @app_commands.command(name="songinstatus", description="Toggle showing current song in bot status (Owner only)")
    async def songinstatus(self, interaction: discord.Interaction):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        current = server_settings.get_setting(interaction.guild_id, 'song_in_status')
        new_value = not current
        server_settings.set_setting(interaction.guild_id, 'song_in_status', new_value)
        
        self.bot.song_in_status = new_value
        
        if not new_value:
            await self.bot.change_presence(activity=discord.Activity(
                type=discord.ActivityType.listening, name="music | /help"
            ))
        
        status = "✅ Enabled" if new_value else "❌ Disabled"
        await interaction.response.send_message(f"🎵 Song in status: {status}")
    
    @app_commands.command(name="247", description="Toggle 24/7 mode - bot stays in voice channel (Admin only)")
    async def stay_in_channel(self, interaction: discord.Interaction):
        if not interaction.user.guild_permissions.administrator and not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Admin only.", ephemeral=True)
        
        current = server_settings.get_setting(interaction.guild_id, 'stay_in_channel')
        new_value = not current
        server_settings.set_setting(interaction.guild_id, 'stay_in_channel', new_value)
        
        if new_value:
            await interaction.response.send_message("✅ **24/7 mode enabled** — Bot will stay in voice channel.")
        else:
            await interaction.response.send_message("❌ **24/7 mode disabled** — Bot will disconnect when idle/alone.")
    
    @app_commands.command(name="autoplaylist", description="Set a playlist to auto-load when bot joins (Owner only)")
    @app_commands.describe(name="Playlist name (leave empty to disable)")
    async def autoplaylist(self, interaction: discord.Interaction, name: str = None):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        if name:
            # Check if playlist exists using PlaylistService
            from services.storage import playlist_service
            playlist = playlist_service.get_playlist(interaction.user.id, name)
            
            if not playlist:
                return await interaction.response.send_message(f'Playlist "{name}" not found.', ephemeral=True)
            
            server_settings.set_setting(interaction.guild_id, 'auto_playlist', {
                'user_id': interaction.user.id,
                'name': name
            })
            await interaction.response.send_message(
                f"✅ Auto-playlist set to **{name}**.\nThis playlist will auto-load when the bot joins voice."
            )
        else:
            server_settings.set_setting(interaction.guild_id, 'auto_playlist', None)
            await interaction.response.send_message("✅ Auto-playlist disabled.")
    
    @app_commands.command(name="serversettings", description="View server settings")
    async def serversettings(self, interaction: discord.Interaction):
        settings = server_settings.get_settings(interaction.guild_id)
        
        embed = discord.Embed(title="⚙️ Server Settings", color=discord.Color.blue())
        
        # Text channel
        tc = f"<#{settings['text_channel_id']}>" if settings['text_channel_id'] else "Any"
        embed.add_field(name="Text Channel", value=tc, inline=True)
        
        # Voice channel
        vc = f"<#{settings['voice_channel_id']}>" if settings['voice_channel_id'] else "Any"
        embed.add_field(name="Voice Channel", value=vc, inline=True)
        
        # DJ role
        dj = f"<@&{settings['dj_role_id']}>" if settings['dj_role_id'] else "None"
        embed.add_field(name="DJ Role", value=dj, inline=True)
        
        # Queue type
        embed.add_field(name="Queue Type", value=settings['queue_type'].title(), inline=True)
        
        # Skip ratio
        ratio = settings['skip_ratio'] if settings['skip_ratio'] else 0.5
        embed.add_field(name="Skip Ratio", value=f"{int(ratio * 100)}%", inline=True)
        
        # 24/7 mode
        embed.add_field(name="24/7 Mode", value="✅" if settings['stay_in_channel'] else "❌", inline=True)
        
        # Song in status
        embed.add_field(name="Song in Status", value="✅" if settings['song_in_status'] else "❌", inline=True)
        
        # Auto playlist
        auto_pl = settings.get('auto_playlist')
        if auto_pl:
            embed.add_field(name="Auto-Playlist", value=auto_pl['name'], inline=True)
        else:
            embed.add_field(name="Auto-Playlist", value="None", inline=True)
        
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Admin(bot))
