"""
Owner cog - Bot owner commands
setavatar, setname, setstatus, setgame, shutdown, debug
"""

import discord
from discord import app_commands
from discord.ext import commands
import wavelink
import aiohttp
import os


def is_owner(user_id: int) -> bool:
    """Check if user is the bot owner."""
    owner_id = os.getenv('OWNER_ID')
    return owner_id and str(user_id) == owner_id


class Owner(commands.Cog):
    """Bot owner commands."""
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    @app_commands.command(name="setavatar", description="Change the bot's avatar (Owner only)")
    @app_commands.describe(url="Image URL for the new avatar")
    async def setavatar(self, interaction: discord.Interaction, url: str):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        await interaction.response.defer(ephemeral=True)
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status != 200:
                        return await interaction.followup.send("❌ Failed to download image.")
                    data = await resp.read()
            
            await self.bot.user.edit(avatar=data)
            await interaction.followup.send("✅ Avatar changed!")
        except Exception as e:
            await interaction.followup.send(f"❌ Error: {e}")
    
    @app_commands.command(name="setname", description="Change the bot's username (Owner only)")
    @app_commands.describe(name="New username")
    async def setname(self, interaction: discord.Interaction, name: str):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        await interaction.response.defer(ephemeral=True)
        
        try:
            await self.bot.user.edit(username=name)
            await interaction.followup.send(f"✅ Username changed to **{name}**!")
        except discord.HTTPException as e:
            await interaction.followup.send(f"❌ Failed: {e}")
    
    @app_commands.command(name="setstatus", description="Set the bot's status (Owner only)")
    @app_commands.choices(status=[
        app_commands.Choice(name="Online", value="online"),
        app_commands.Choice(name="Idle", value="idle"),
        app_commands.Choice(name="Do Not Disturb", value="dnd"),
        app_commands.Choice(name="Invisible", value="invisible"),
    ])
    async def setstatus(self, interaction: discord.Interaction, status: str):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        status_map = {
            'online': discord.Status.online,
            'idle': discord.Status.idle,
            'dnd': discord.Status.dnd,
            'invisible': discord.Status.invisible,
        }
        
        await self.bot.change_presence(status=status_map[status])
        await interaction.response.send_message(f"✅ Status changed to **{status}**!", ephemeral=True)
    
    @app_commands.command(name="setgame", description="Set the bot's activity (Owner only)")
    @app_commands.describe(activity_type="Type of activity", text="Activity text")
    @app_commands.choices(activity_type=[
        app_commands.Choice(name="Playing", value="playing"),
        app_commands.Choice(name="Listening to", value="listening"),
        app_commands.Choice(name="Watching", value="watching"),
        app_commands.Choice(name="Competing in", value="competing"),
    ])
    async def setgame(self, interaction: discord.Interaction, activity_type: str, text: str):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        type_map = {
            'playing': discord.ActivityType.playing,
            'listening': discord.ActivityType.listening,
            'watching': discord.ActivityType.watching,
            'competing': discord.ActivityType.competing,
        }
        
        activity = discord.Activity(type=type_map[activity_type], name=text)
        await self.bot.change_presence(activity=activity)
        await interaction.response.send_message(f"✅ Activity set!", ephemeral=True)
    
    @app_commands.command(name="shutdown", description="Shutdown the bot (Owner only)")
    async def shutdown(self, interaction: discord.Interaction):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        await interaction.response.send_message("👋 Shutting down...", ephemeral=True)
        
        for vc in self.bot.voice_clients:
            try:
                await vc.disconnect()
            except:
                pass
        
        await self.bot.close()
    
    @app_commands.command(name="debug", description="Show debug information (Owner only)")
    async def debug(self, interaction: discord.Interaction):
        if not is_owner(interaction.user.id):
            return await interaction.response.send_message("🔒 Owner only.", ephemeral=True)
        
        embed = discord.Embed(title="🔧 Debug Information", color=0xFF6B6B)
        
        # Bot stats
        guilds = len(self.bot.guilds)
        voice_connections = len(self.bot.voice_clients)
        total_users = sum(g.member_count or 0 for g in self.bot.guilds)
        import time
        uptime = int(time.time() - getattr(self.bot, 'start_time', time.time()))
        
        embed.add_field(
            name="Bot",
            value=f"User: {self.bot.user}\nID: {self.bot.user.id}\nGuilds: {guilds}\nUptime: {uptime}s",
            inline=True
        )
        
        # Config
        config = getattr(self.bot, 'config', None)
        if config:
            config_info = [
                f"Owner: {config.owner_id or 'Not set'}",
                f"DJ Role: {config.dj_role_id or 'Not set'}",
                f"Default Volume: {config.default_volume}%",
                f"Max Queue: {config.max_queue_size or 'Unlimited'}",
                f"Max Duration: {config.max_duration or 'Unlimited'}s",
                f"Skip Ratio: {int(config.skip_ratio * 100)}%"
            ]
            embed.add_field(name="Config", value="\n".join(config_info), inline=True)
        
        # Lavalink
        nodes = wavelink.Pool.nodes
        node_info = []
        for identifier, node in nodes.items():
            status = "Connected" if node.status.is_connected else "Disconnected"
            node_info.append(f"Node: {identifier}")
            node_info.append(f"State: {status}")
            node_info.append(f"Players: {len(self.bot.voice_clients)}")
        
        embed.add_field(
            name="Lavalink",
            value="\n".join(node_info) if node_info else "No nodes",
            inline=True
        )
        
        embed.timestamp = discord.utils.utcnow()
        await interaction.response.send_message(embed=embed, ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(Owner(bot))
