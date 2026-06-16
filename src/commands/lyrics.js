import { Command, Declare, Options, createStringOption, Embed } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import https from 'https';
import dns from 'dns';

// Setup DNS-over-HTTPS (DoH) with direct DNS fallbacks
async function resolveDoH(hostname) {
    const tryDoH = async (url) => {
        const res = await fetch(url, {
            headers: { 'Accept': 'application/dns-json' },
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        if (json.Answer && json.Answer.length > 0) {
            const aRecord = json.Answer.find(a => a.type === 1); // Type 1 is A record (IPv4)
            if (aRecord) return aRecord.data;
        }
        throw new Error('No valid A record');
    };

    try {
        // Primary: Cloudflare DoH
        console.log(`[DNS] Resolving ${hostname} via Cloudflare DoH`);
        const ip = await tryDoH(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`);
        console.log(`[DNS] Resolved ${hostname} to ${ip} via Cloudflare DoH`);
        return ip;
    } catch (err) {
        console.warn(`[DNS] Cloudflare DoH failed for ${hostname}:`, err.message || err);
        try {
            // Fallback 1: Google DoH
            console.log(`[DNS] Resolving ${hostname} via Google DoH`);
            const ip = await tryDoH(`https://dns.google/resolve?name=${hostname}&type=A`);
            console.log(`[DNS] Resolved ${hostname} to ${ip} via Google DoH`);
            return ip;
        } catch (err2) {
            console.warn(`[DNS] Google DoH failed for ${hostname}:`, err2.message || err2);
            try {
                // Fallback 2: Direct custom DNS (1.1.1.1 & 8.8.8.8)
                console.log(`[DNS] Resolving ${hostname} via direct DNS resolver (1.1.1.1 / 8.8.8.8)`);
                const resolver = new dns.promises.Resolver();
                resolver.setServers(['1.1.1.1', '8.8.8.8', '1.0.0.1', '8.8.4.4']);
                const addresses = await resolver.resolve4(hostname);
                if (addresses && addresses.length > 0) {
                    const ip = addresses[0];
                    console.log(`[DNS] Resolved ${hostname} to ${ip} via direct DNS resolver`);
                    return ip;
                }
                throw new Error('No addresses found');
            } catch (err3) {
                console.warn(`[DNS] Direct DNS resolver failed for ${hostname}:`, err3.message || err3);
                // Fallback 3: System default DNS resolution as final fallback
                console.log(`[DNS] Resolving ${hostname} via system default resolver`);
                const addresses = await dns.promises.resolve4(hostname);
                if (addresses && addresses.length > 0) {
                    const ip = addresses[0];
                    console.log(`[DNS] Resolved ${hostname} to ${ip} via system default resolver`);
                    return ip;
                }
                throw new Error(`Failed to resolve ${hostname} via all methods`);
            }
        }
    }
}

function cleanTitle(title, author) {
    if (!title) return '';
    let clean = title
        .replace(/\s*[\[\(].*?(official|video|audio|lyrics|hd|hq|4k|1080p|720p|visualizer|mv|m\/v).*?[\]\)]/gi, '')
        .replace(/\s*[\[\(].*?(ft\.?|feat\.?|featuring).*?[\]\)]/gi, '')
        .replace(/\s*-\s*(official|video|audio|lyrics|hd|hq).*/gi, '')
        .replace(/\s*\|\s*.*/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (author && !clean.toLowerCase().includes(author.toLowerCase())) {
        clean = `${clean} - ${author}`; // Formatted as "Song - Artist"
    }
    return clean;
}

async function fetchJson(urlString) {
    const parsedUrl = new URL(urlString);
    
    const makeRequest = async (urlStr, ip = null) => {
        const fetchUrl = ip 
            ? urlStr.replace(parsedUrl.hostname, ip) 
            : urlStr;
        
        const headers = {
            'User-Agent': 'SeyfertMusicBot/1.0 (Discord Bot)',
            'Accept': 'application/json'
        };
        
        if (ip) {
            headers['Host'] = parsedUrl.hostname;
        }

        const options = {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(15000)
        };

        if (ip) {
            options.tls = {
                serverName: parsedUrl.hostname
            };
        }

        const res = await fetch(fetchUrl, options);
        if (!res.ok) {
            return { ok: false, status: res.status };
        }
        
        const data = await res.json();
        return { ok: true, data };
    };

    // Try Option A: Resolve IP via DoH first
    try {
        const ip = await resolveDoH(parsedUrl.hostname);
        if (ip) {
            console.log(`[HTTP] Attempting native fetch to resolved IP: ${ip} for ${parsedUrl.hostname}`);
            return await makeRequest(urlString, ip);
        }
    } catch (err) {
        console.warn(`[HTTP] Native fetch to IP-resolved host failed for ${parsedUrl.hostname}:`, err.message || err);
    }

    // Try Option B: Direct hostname connection
    try {
        console.log(`[HTTP] Falling back to direct native fetch for ${parsedUrl.hostname}`);
        return await makeRequest(urlString);
    } catch (err) {
        console.error(`[HTTP] Direct native fetch failed for ${parsedUrl.hostname}:`, err.message || err);
        throw err;
    }
}

const lyricsOptions = {
    query: createStringOption({
        description: 'Song to search for (leave empty for current)',
        required: false
    })
};

@Declare({
    name: 'lyrics',
    description: 'Get lyrics for the current or specified song'
})
@Options(lyricsOptions)
export default class LyricsCommand extends Command {
    async run(ctx) {
        await ctx.deferReply();
        
        const queue = musicManager.getQueue(ctx.guildId);
        const query = ctx.options.query;
        
        let searchTerm;
        if (query) {
            searchTerm = query;
        } else if (queue?.songs?.length > 0) {
            const song = queue.songs[0];
            searchTerm = cleanTitle(song.title, song.uploader?.name);
        } else {
            return ctx.editOrReply({ content: '❌ Nothing is playing. Specify a song to search for.' });
        }

        try {
            // Split logic: assume "Song - Artist" format when split by a dash
            let artist = null;
            let songName = searchTerm;
            if (searchTerm.includes('-') || searchTerm.includes('–')) {
                const parts = searchTerm.split(/\s*[-–]\s*/);
                songName = parts[0];
                artist = parts.slice(1).join(' - ');
            }
            
            let lyrics = null;
            let source = 'API';
            let trackInfo = {
                title: null,
                artist: null,
                album: null,
                url: null
            };
            
            // Primary: LRCLIB (massive open source lyrics database)
            if (!lyrics) {
                try {
                    console.log(`[LRCLIB] Searching q=${searchTerm}`);
                    const response = await fetchJson(`https://lrclib.net/api/search?q=${encodeURIComponent(searchTerm)}`);
                    if (response.ok) {
                        const data = response.data;
                        if (Array.isArray(data) && data.length > 0) {
                            // Find the first result that actually has lyrics
                            const validMatch = data.find(track => track.plainLyrics);
                            if (validMatch) {
                                lyrics = validMatch.plainLyrics;
                                source = 'LRCLIB';
                                trackInfo.title = validMatch.name;
                                trackInfo.artist = validMatch.artistName;
                                trackInfo.album = validMatch.albumName;
                            } else {
                                console.log(`[LRCLIB] q search returned tracks but no plainLyrics`);
                            }
                        } else {
                            console.log(`[LRCLIB] q search returned empty array`);
                        }
                    } else {
                        console.log(`[LRCLIB] q search failed with status ${response.status}`);
                    }
                } catch (e) {
                    console.error(`[LRCLIB] q search error:`, e.message || e);
                }
            }
            
            // Fallback 1: LRCLIB with split artist/title (only if we have an artist)
            if (!lyrics && artist && songName) {
                try {
                    console.log(`[LRCLIB] Searching track=${songName} artist=${artist}`);
                    const response = await fetchJson(`https://lrclib.net/api/search?track_name=${encodeURIComponent(songName)}&artist_name=${encodeURIComponent(artist)}`);
                    if (response.ok) {
                        const data = response.data;
                        if (Array.isArray(data) && data.length > 0) {
                            const validMatch = data.find(track => track.plainLyrics);
                            if (validMatch) {
                                lyrics = validMatch.plainLyrics;
                                source = 'LRCLIB';
                                trackInfo.title = validMatch.name;
                                trackInfo.artist = validMatch.artistName;
                                trackInfo.album = validMatch.albumName;
                            }
                        }
                    }
                } catch (e) {
                    console.error(`[LRCLIB] track/artist search error:`, e.message || e);
                }
            }
            
            // Fallback 2: some-random-api.com (works on global query search)
            if (!lyrics) {
                try {
                    console.log(`[some-random-api] Searching title=${searchTerm}`);
                    const response = await fetchJson(`https://some-random-api.com/lyrics?title=${encodeURIComponent(searchTerm)}`);
                    if (response.ok) {
                        const data = response.data;
                        if (data.lyrics) {
                            lyrics = data.lyrics;
                            source = 'some-random-api.com';
                            trackInfo.title = data.title;
                            trackInfo.artist = data.author;
                            trackInfo.url = data.links?.genius;
                        }
                    }
                } catch (e) {
                    console.error(`[some-random-api] search error:`, e.message || e);
                }
            }

            // Fallback 3: lyrics.ovh
            if (!lyrics && artist && songName) {
                try {
                    console.log(`[lyrics.ovh] Searching artist=${artist} song=${songName}`);
                    const response = await fetchJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(songName)}`);
                    if (response.ok) {
                        const data = response.data;
                        if (data.lyrics) {
                            lyrics = data.lyrics;
                            source = 'lyrics.ovh';
                            trackInfo.title = songName;
                            trackInfo.artist = artist;
                        }
                    }
                } catch (e) {
                    console.error(`[lyrics.ovh] search error:`, e.message || e);
                }
            }
            
            if (!lyrics) {
                return ctx.editOrReply({ content: `❌ No lyrics found for **${searchTerm}**\n\nTry using the format: \`Artist - Song Title\`` });
            }
            
            lyrics = lyrics.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
            
            const maxLength = 3800;
            const chunks = [];
            
            if (lyrics.length <= maxLength) {
                chunks.push(lyrics);
            } else {
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
            
            const embeds = chunks.map((chunk, i) => {
                const embed = new Embed()
                    .setColor('#5865F2')
                    .setDescription(chunk);
                
                if (i === 0) {
                    let titleString = `📜 Lyrics: ${searchTerm.slice(0, 200)}`;
                    if (trackInfo.title && trackInfo.artist) {
                        titleString = `📜 Lyrics: ${trackInfo.title} - ${trackInfo.artist}`;
                    }
                    embed.setTitle(titleString);

                    // Build metadata line
                    let metadata = [];
                    if (trackInfo.title) metadata.push(`**Track:** ${trackInfo.title}`);
                    if (trackInfo.artist) metadata.push(`**Artist:** ${trackInfo.artist}`);
                    if (trackInfo.album) metadata.push(`**Album:** ${trackInfo.album}`);
                    
                    // Genius search fallback link or specific link
                    const finalUrl = trackInfo.url || `https://genius.com/search?q=${encodeURIComponent((trackInfo.title || searchTerm) + ' ' + (trackInfo.artist || ''))}`;
                    metadata.push(`**Genius Link:** [Search](${finalUrl})`);

                    embed.setDescription(`${metadata.join('\n')}\n\n${chunk}`);
                }
                if (i === chunks.length - 1) {
                    embed.setFooter({ text: `Source: ${source} • Tip: /lyrics "Song - Artist" for better results` });
                }
                return embed;
            });
            
            await ctx.editOrReply({ embeds: [embeds[0]] });
            
            // Seyfert handles followups automatically or through webhooks. For simplicity we just send the rest:
            // Since ctx.write doesn't append easily after editOrReply, we can just send max one embed for now 
            // or use client.messages.write(ctx.channelId, { embeds: [embeds[i]] })
            for (let i = 1; i < embeds.length && i < 3; i++) {
                await ctx.client.messages.write(ctx.channelId, { embeds: [embeds[i]] });
            }
            
            if (embeds.length > 3) {
                await ctx.client.messages.write(ctx.channelId, { content: `*...lyrics truncated (${embeds.length - 3} more pages)*` });
            }

        } catch (error) {
            return ctx.editOrReply({ content: `❌ Failed to fetch lyrics: ${error.message}` });
        }
    }
}
