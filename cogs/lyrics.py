"""
Lyrics cog - Fetch song lyrics
"""

import discord
from discord import app_commands
from discord.ext import commands
import wavelink
import aiohttp
import re
from typing import cast


class Lyrics(commands.Cog):
    """Lyrics commands."""
    
    LYRICS_API = "https://api.lyrics.ovh/v1"
    
    def __init__(self, bot: commands.Bot):
        self.bot = bot
    
    def _clean_title(self, title: str) -> tuple[str, str]:
        """Clean song title and extract artist/song."""
        cleanups = [
            r'\(official\s*(music\s*)?video\)',
            r'\(official\s*audio\)',
            r'\(lyric\s*video\)',
            r'\(lyrics?\)',
            r'\(visualizer\)',
            r'\[official.*?\]',
            r'\[lyrics?\]',
            r'\(audio\)',
            r'\[audio\]',
            r'\(hd\)',
            r'\(hq\)',
            r'\(4k\)',
            r'official video',
            r'official audio',
            r'music video',
            r'lyric video',
            r'ft\.',
            r'feat\.',
        ]
        
        cleaned = title
        for pattern in cleanups:
            cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)
        
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        # Split by common separators
        for sep in [' - ', ' – ', ' — ', ' | ', ' // ']:
            if sep in cleaned:
                parts = cleaned.split(sep, 1)
                return parts[0].strip(), parts[1].strip()
        
        return '', cleaned
    
    async def _fetch_lyrics(self, artist: str, song: str) -> str | None:
        """Fetch lyrics from API."""
        try:
            url = f"{self.LYRICS_API}/{artist}/{song}"
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        return data.get('lyrics')
        except:
            pass
        return None
    
    async def _search_lyrics(self, query: str) -> str | None:
        """Try multiple strategies to find lyrics."""
        artist, song = self._clean_title(query)
        
        if artist and song:
            lyrics = await self._fetch_lyrics(artist, song)
            if lyrics:
                return lyrics
            lyrics = await self._fetch_lyrics(song, artist)
            if lyrics:
                return lyrics
        
        if song:
            lyrics = await self._fetch_lyrics('', song)
            if lyrics:
                return lyrics
        
        return await self._fetch_lyrics('', query)
    
    @app_commands.command(name="lyrics", description="Get lyrics for the current or specified song")
    @app_commands.describe(query="Song name (optional - defaults to current song)")
    async def lyrics(self, interaction: discord.Interaction, query: str = None):
        await interaction.response.defer()
        
        search_query = query
        
        if not search_query:
            player = cast(wavelink.Player, interaction.guild.voice_client)
            
            if not player or not player.current:
                return await interaction.followup.send(
                    "❌ No song playing. Provide a song name to search.",
                    ephemeral=True
                )
            
            search_query = player.current.title
        
        lyrics = await self._search_lyrics(search_query)
        
        if not lyrics:
            return await interaction.followup.send(
                f"❌ No lyrics found for **{search_query}**.\n"
                "Try: `Artist - Song Name`"
            )
        
        artist, song = self._clean_title(search_query)
        display_title = f"{artist} - {song}" if artist else song
        
        # Clean up lyrics
        lyrics = lyrics.replace('\r\n', '\n').strip()
        lyrics = re.sub(r'\n{3,}', '\n\n', lyrics)
        
        # Split if too long - by paragraphs like JS version
        if len(lyrics) > 4000:
            chunks = []
            paragraphs = lyrics.split('\n\n')
            current = ""
            
            for para in paragraphs:
                if len(current) + len(para) + 2 > 4000:
                    if current:
                        chunks.append(current.strip())
                    current = para
                else:
                    current += ('\n\n' + para) if current else para
            
            if current:
                chunks.append(current.strip())
            
            embed = discord.Embed(
                title=f"🎵 {display_title}",
                description=chunks[0],
                color=discord.Color.purple()
            )
            embed.set_footer(text=f"Part 1/{len(chunks)}")
            await interaction.followup.send(embed=embed)
            
            for i, chunk in enumerate(chunks[1:], 2):
                embed = discord.Embed(description=chunk, color=discord.Color.purple())
                embed.set_footer(text=f"Part {i}/{len(chunks)}")
                await interaction.channel.send(embed=embed)
        else:
            embed = discord.Embed(
                title=f"🎵 {display_title}",
                description=lyrics,
                color=discord.Color.purple()
            )
            embed.set_footer(text="Lyrics from lyrics.ovh")
            await interaction.followup.send(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Lyrics(bot))
