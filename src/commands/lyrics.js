const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

/**
 * Extract clean search terms from a track title
 * Removes common tags like (Official Video), [Lyrics], etc.
 */
function cleanTitle(title, author) {
  if (!title) return '';
  
  // Remove common video/audio tags
  let clean = title
    .replace(/\s*[\[\(].*?(official|video|audio|lyrics|hd|hq|4k|1080p|720p|visualizer|mv|m\/v).*?[\]\)]/gi, '')
    .replace(/\s*[\[\(].*?(ft\.?|feat\.?|featuring).*?[\]\)]/gi, '')
    .replace(/\s*-\s*(official|video|audio|lyrics|hd|hq).*/gi, '')
    .replace(/\s*\|\s*.*/gi, '') // Remove everything after |
    .replace(/\s+/g, ' ')
    .trim();
  
  // If author is in the title, might already have "Artist - Song" format
  if (author && !clean.toLowerCase().includes(author.toLowerCase())) {
    clean = `${author} ${clean}`;
  }
  
  return clean;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Get lyrics for the current or specified song')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('Song to search for (leave empty for current)')
        .setRequired(false)
    ),

  async execute(interaction, client) {
    await interaction.deferReply();

    const queue = client.distube.getQueue(interaction.guildId);
    const query = interaction.options.getString('query');
    
    let searchTerm;
    
    if (query) {
      searchTerm = query;
    } else if (queue?.songs?.length > 0) {
      const song = queue.songs[0];
      searchTerm = cleanTitle(song.name, song.uploader?.name);
    } else {
      return interaction.editReply({ content: '❌ Nothing is playing. Specify a song to search for.', ephemeral: true });
    }

    try {
      // Use a free lyrics API (lyrics.ovh)
      const [artist, ...songParts] = searchTerm.split(/\s*[-–]\s*/);
      let song = songParts.join(' - ') || artist;
      
      // Try lyrics.ovh API first (free, no API key needed)
      let lyrics = null;
      let source = 'lyrics.ovh';
      
      try {
        const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(song)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.lyrics) {
            lyrics = data.lyrics;
          }
        }
      } catch (e) {
        // lyrics.ovh failed, try alternate approach
      }
      
      // If first attempt failed, try with swapped artist/song
      if (!lyrics && song !== artist) {
        try {
          const response = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(song)}/${encodeURIComponent(artist)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.lyrics) {
              lyrics = data.lyrics;
            }
          }
        } catch (e) {
          // Fallback also failed
        }
      }
      
      // Try using the full search term as song name with "Unknown" artist
      if (!lyrics) {
        try {
          const response = await fetch(`https://api.lyrics.ovh/v1/Unknown/${encodeURIComponent(searchTerm)}`);
          if (response.ok) {
            const data = await response.json();
            if (data.lyrics) {
              lyrics = data.lyrics;
            }
          }
        } catch (e) {
          // Final fallback failed
        }
      }
      
      if (!lyrics) {
        return interaction.editReply(`❌ No lyrics found for **${searchTerm}**\n\nTry using the format: \`Artist - Song Title\``);
      }
      
      // Clean up lyrics
      lyrics = lyrics
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      // Split into chunks if too long (Discord limit is 4096 for embed description)
      const maxLength = 4000;
      const chunks = [];
      
      if (lyrics.length <= maxLength) {
        chunks.push(lyrics);
      } else {
        // Split by paragraphs/verses
        const paragraphs = lyrics.split(/\n\n+/);
        let currentChunk = '';
        
        for (const para of paragraphs) {
          if ((currentChunk + '\n\n' + para).length > maxLength) {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = para;
          } else {
            currentChunk += (currentChunk ? '\n\n' : '') + para;
          }
        }
        if (currentChunk) chunks.push(currentChunk.trim());
      }
      
      // Create embed(s)
      const embeds = chunks.map((chunk, i) => {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setDescription(chunk);
        
        if (i === 0) {
          embed.setTitle(`📜 Lyrics: ${searchTerm.slice(0, 200)}`);
        }
        
        if (i === chunks.length - 1) {
          embed.setFooter({ text: `Source: ${source} • Tip: /lyrics "Artist - Song" for better results` });
        }
        
        return embed;
      });
      
      // Send first embed
      await interaction.editReply({ embeds: [embeds[0]] });
      
      // Send additional embeds as follow-ups if needed
      for (let i = 1; i < embeds.length && i < 3; i++) {
        await interaction.followUp({ embeds: [embeds[i]] });
      }
      
      if (embeds.length > 3) {
        await interaction.followUp({ content: `*...lyrics truncated (${embeds.length - 3} more pages)*` });
      }

    } catch (error) {
      console.error('Lyrics error:', error);
      return interaction.editReply(`❌ Failed to fetch lyrics: ${error.message || 'Unknown error'}`);
    }
  }
};
