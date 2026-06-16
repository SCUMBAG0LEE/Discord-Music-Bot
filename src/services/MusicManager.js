import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
    StreamType
} from '@discordjs/voice';
import { execFile, spawn, spawnSync } from 'child_process';
import prism from 'prism-media';
import { promisify } from 'util';
import { getYtDlpArgs } from '../utils/cookies.js';
import { loadSettings } from './serverSettings.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';

// Configure FFmpeg resolution
try {
    const customFfmpeg = process.env.FFMPEG_PATH;
    const FFmpegClass = prism.default?.FFmpeg || prism.FFmpeg;
    const info = FFmpegClass.getInfo();
    
    if (customFfmpeg) {
        const customResult = spawnSync(customFfmpeg, ['-version'], { windowsHide: true });
        if (!customResult.error && customResult.stdout) {
            const output = customResult.stdout.toString();
            const match = /version\s+([^\s]+)/.exec(output) || /version ([^\s]+) Copyright/.exec(output);
            const version = match ? match[1] : 'unknown';
            
            FFmpegClass.getInfo = () => ({
                command: customFfmpeg,
                output,
                version
            });
            logger.info('FFmpeg', `Using custom FFmpeg from env: ${customFfmpeg}`);
        } else {
            logger.warn('FFmpeg', `Custom FFmpeg path (${customFfmpeg}) is invalid, falling back...`);
        }
    }

    if (!customFfmpeg || info.command !== customFfmpeg) {
        const result = spawnSync('ffmpeg', ['-version'], { windowsHide: true });
        if (result.error || !result.stdout) {
            logger.info('FFmpeg', 'System FFmpeg not found, falling back to ffmpeg-static.');
            logger.debug('FFmpeg', `Using path: ${info.command}`);
        } else {
            const output = result.stdout.toString();
            const match = /version\s+([^\s]+)/.exec(output) || /version ([^\s]+) Copyright/.exec(output);
            const version = match ? match[1] : 'unknown';
            
            FFmpegClass.getInfo = () => ({
                command: 'ffmpeg',
                output,
                version
            });
            logger.info('FFmpeg', 'System FFmpeg found! Using it directly instead of ffmpeg-static.');
            logger.debug('FFmpeg', 'System FFmpeg generally provides better performance and streaming capabilities.');
        }
    }
} catch (e) {
    logger.error('FFmpeg', 'Error configuring FFmpeg path, using fallback.', e);
}

const execFileAsync = promisify(execFile);

export const voiceAdapters = new Map();

export function createSeyfertAdapter(client, guildId) {
    return (methods) => {
        voiceAdapters.set(guildId, methods);
        return {
            sendPayload: (payload) => {
                if (payload.op === 4 && payload.d) {
                    payload.d.self_mute = payload.d.self_mute || false;
                    payload.d.self_deaf = true; // High performance (deafens bot to avoid processing incoming voice packets)
                }
                const shardId = client.gateway.calculateShardId(guildId);
                const finalPayload = JSON.parse(JSON.stringify(payload));
                console.log('[Voice Payload Dump]:', JSON.stringify(finalPayload));
                client.gateway.send(shardId, finalPayload);
                return true;
            },
            destroy: () => {
                voiceAdapters.delete(guildId);
            }
        };
    };
}

function isPlaylist(query) {
    if (!query.startsWith('http://') && !query.startsWith('https://')) return null;
    
    if (query.includes('youtube.com/playlist') || (query.includes('youtube.com/watch') && query.includes('list=')) || query.includes('youtu.be/playlist')) {
        return 'youtube';
    }
    if (query.includes('soundcloud.com/') && query.includes('/sets/')) {
        return 'soundcloud';
    }
    if (query.includes('spotify.com/playlist/') || query.includes('spotify.com/embed/playlist/')) {
        return 'spotify_playlist';
    }
    if (query.includes('spotify.com/album/') || query.includes('spotify.com/embed/album/')) {
        return 'spotify_album';
    }
    if (query.includes('deezer.com/') && query.includes('/playlist/')) {
        return 'deezer_playlist';
    }
    if (query.includes('deezer.com/') && query.includes('/album/')) {
        return 'deezer_album';
    }
    if (query.includes('music.apple.com/') && query.includes('/playlist/')) {
        return 'apple_playlist';
    }
    if (query.includes('music.apple.com/') && query.includes('/album/')) {
        return 'apple_album';
    }
    if (query.includes('.bandcamp.com/album/')) {
        return 'bandcamp_album';
    }
    return null;
}

async function fetchSpotifyTracks(url) {
    let match = url.match(/spotify\.com\/(playlist|album)\/([a-zA-Z0-9]+)/);
    if (!match) {
        throw new Error('Invalid Spotify URL. Only playlists and albums are supported.');
    }
    const type = match[1];
    const id = match[2];
    const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
    
    const response = await fetch(embedUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    
    if (!response.ok) {
        throw new Error(`Failed to fetch Spotify embed: ${response.statusText}`);
    }
    
    const text = await response.text();
    const nextDataMatch = text.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (!nextDataMatch) {
        throw new Error('Could not parse Spotify metadata');
    }
    
    const json = JSON.parse(nextDataMatch[1]);
    const entity = json.props?.pageProps?.state?.data?.entity;
    if (!entity) {
        throw new Error('No playlist/album tracks found on this page');
    }
    
    const name = entity.name || entity.title || 'Spotify Content';
    const rawTracks = entity.trackList || [];
    
    const tracks = rawTracks.map(track => {
        const title = track.title;
        const artist = track.subtitle || 'Unknown Artist';
        const durationMs = track.duration || 0;
        const durationMin = Math.floor(durationMs / 60000);
        const durationSec = String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0');
        const duration = durationMs ? `${durationMin}:${durationSec}` : 'Live/Unknown';
        
        return {
            title: `${title} - ${artist}`,
            originalUrl: `ytsearch1:${title} ${artist}`,
            duration,
            sourceType: 'youtube'
        };
    });
    
    return { name, tracks };
}

let cachedAppleToken = null;
let appleTokenExpiry = 0;

async function getAppleMusicToken() {
    if (cachedAppleToken && Date.now() < appleTokenExpiry) {
        return cachedAppleToken;
    }
    const mainPageRes = await fetch('https://music.apple.com/us/browse', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    if (!mainPageRes.ok) {
        throw new Error(`Failed to load Apple Music page: ${mainPageRes.statusText}`);
    }
    const html = await mainPageRes.text();
    const indexScriptMatch = html.match(/src="([^"]*\/assets\/index~[^"]+\.js)"/i);
    if (!indexScriptMatch) {
        throw new Error('Could not find Apple Music index asset script URL');
    }
    let indexScriptUrl = indexScriptMatch[1];
    if (indexScriptUrl.startsWith('/')) {
        indexScriptUrl = 'https://music.apple.com' + indexScriptUrl;
    }
    const scriptRes = await fetch(indexScriptUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    if (!scriptRes.ok) {
        throw new Error(`Failed to load Apple Music asset script: ${scriptRes.statusText}`);
    }
    const scriptText = await scriptRes.text();
    const jwtRegex = /eyJ[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_=]+\.[a-zA-Z0-9-_]+/g;
    const matches = scriptText.match(jwtRegex);
    if (!matches || matches.length === 0) {
        throw new Error('Failed to extract JWT token from Apple Music script');
    }
    const token = matches[0];
    try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf-8'));
        if (payload.exp) {
            appleTokenExpiry = payload.exp * 1000 - 600000;
        } else {
            appleTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
        }
    } catch (e) {
        appleTokenExpiry = Date.now() + 24 * 60 * 60 * 1000;
    }
    cachedAppleToken = token;
    return cachedAppleToken;
}

async function resolveUrlRedirects(url) {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname;
        if (host.includes('link.deezer.com') || host.includes('deezer.page.link') || host.includes('apple.co') || host.includes('spotify.link')) {
            const response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            return response.url;
        }
    } catch (e) {
        console.error('[Redirect Resolver Error]', e);
    }
    return url;
}

async function fetchDeezerTracks(url) {
    const match = url.match(/deezer\.com\/(?:\w{2}\/)?(playlist|album)\/(\d+)/);
    if (!match) {
        throw new Error('Invalid Deezer URL. Playlists and albums are supported.');
    }
    const type = match[1];
    const id = match[2];
    const apiUrl = `https://api.deezer.com/${type}/${id}`;
    
    const res = await fetch(apiUrl);
    if (!res.ok) {
        throw new Error(`Failed to fetch Deezer data: ${res.statusText}`);
    }
    const data = await res.json();
    if (data.error) {
        throw new Error(`Deezer API error: ${data.error.message || 'Unknown error'}`);
    }
    
    const name = data.title || 'Deezer Content';
    const rawTracks = data.tracks?.data || [];
    
    const tracks = rawTracks.map(track => {
        const title = track.title;
        const artist = track.artist?.name || 'Unknown Artist';
        const durationSec = track.duration || 0;
        const durationMin = Math.floor(durationSec / 60);
        const durationSecRemainder = String(Math.floor(durationSec % 60)).padStart(2, '0');
        const duration = durationSec ? `${durationMin}:${durationSecRemainder}` : 'Live/Unknown';
        
        return {
            title: `${title} - ${artist}`,
            originalUrl: `ytsearch1:${title} ${artist}`,
            duration,
            sourceType: 'youtube'
        };
    });
    
    return { name, tracks };
}

async function fetchAppleMusicTracks(url) {
    const match = url.match(/music\.apple\.com\/(\w{2})\/(playlist|album)\/(?:[^\/]+\/)?([^\/?]+)/);
    if (!match) {
        throw new Error('Invalid Apple Music URL. Playlists and albums are supported.');
    }
    const storefront = match[1];
    const type = match[2];
    const id = match[3];
    
    const token = await getAppleMusicToken();
    const apiUrl = `https://amp-api.music.apple.com/v1/catalog/${storefront}/${type}s/${id}`;
    
    const res = await fetch(apiUrl, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Origin': 'https://music.apple.com',
            'Referer': 'https://music.apple.com/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });
    
    if (!res.ok) {
        throw new Error(`Failed to fetch Apple Music data: ${res.statusText}`);
    }
    
    const data = await res.json();
    if (!data.data || data.data.length === 0) {
        throw new Error('No Apple Music playlist/album found.');
    }
    
    const playlist = data.data[0];
    const name = playlist.attributes?.name || 'Apple Music Content';
    
    let rawTracks = [];
    const tracksRelationship = playlist.relationships?.tracks;
    if (tracksRelationship && tracksRelationship.data) {
        rawTracks = [...tracksRelationship.data];
        let nextUrl = tracksRelationship.next;
        // Limit to 500 tracks to avoid extreme queues
        while (nextUrl && rawTracks.length < 500) {
            const fullNextUrl = `https://amp-api.music.apple.com${nextUrl}`;
            const nextRes = await fetch(fullNextUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Origin': 'https://music.apple.com',
                    'Referer': 'https://music.apple.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (nextRes.ok) {
                const nextData = await nextRes.json();
                if (nextData.data && nextData.data.length > 0) {
                    rawTracks = [...rawTracks, ...nextData.data];
                    nextUrl = nextData.next;
                } else {
                    nextUrl = null;
                }
            } else {
                nextUrl = null;
            }
        }
    }
    
    const tracks = rawTracks.map(track => {
        const attrs = track.attributes || {};
        const title = attrs.name;
        const artist = attrs.artistName || 'Unknown Artist';
        const durationMs = attrs.durationInMillis || 0;
        const durationSec = Math.floor(durationMs / 1000);
        const durationMin = Math.floor(durationSec / 60);
        const durationSecRemainder = String(Math.floor(durationSec % 60)).padStart(2, '0');
        const duration = durationMs ? `${durationMin}:${durationSecRemainder}` : 'Live/Unknown';
        
        return {
            title: `${title} - ${artist}`,
            originalUrl: `ytsearch1:${title} ${artist}`,
            duration,
            sourceType: 'youtube'
        };
    });
    
    return { name, tracks };
}

async function fetchYtDlpPlaylistTracks(url) {
    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
    const args = getYtDlpArgs(['-j', '--flat-playlist', '--no-warnings', url]);
    const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 50 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    
    const tracks = lines.map(line => {
        const data = JSON.parse(line);
        const durationSec = data.duration || 0;
        const durationMin = Math.floor(durationSec / 60);
        const durationSecRemainder = String(Math.floor(durationSec % 60)).padStart(2, '0');
        const duration = durationSec ? `${durationMin}:${durationSecRemainder}` : 'Live/Unknown';
        
        return {
            title: data.title || 'Unknown Track',
            originalUrl: data.url || `https://www.youtube.com/watch?v=${data.id}`,
            duration,
            sourceType: data.extractor === 'soundcloud' ? 'soundcloud' : 'youtube'
        };
    });

    return { name: 'Online Playlist', tracks };
}

async function getSpotifyQuery(url) {
    try {
        const res = await fetch(url);
        const text = await res.text();
        const titleMatch = text.match(/<title>(.*?) \| Spotify<\/title>/);
        if (titleMatch && titleMatch[1]) {
            return titleMatch[1].replace(' - song by ', ' ');
        }
    } catch(e) {}
    throw new Error("Could not parse Spotify URL");
}

async function getTrackInfo(query, searchPrefix = '') {
    const radioPresets = {
        lofi: 'https://streams.ilovemusic.de/iloveradio17.mp3',
        jazz: 'https://streaming.radio.co/s774887f7b/listen',
        classical: 'https://live.musopen.org:8085/streamvbr0',
        chillhop: 'https://streams.fluxfm.de/Chillhop/mp3-320',
        synthwave: 'https://radio.synth.fm/stream',
        rock: 'https://stream.rockradio.com/rock-320?token=free',
        electronic: 'https://stream.radioseda.ir/stream/Techno',
        ambient: 'https://streams.fluxfm.de/chill/mp3-320',
        hiphop: 'https://streams.ilovemusic.de/iloveradio3.mp3'
    };
    const presetEntry = Object.entries(radioPresets).find(([name, url]) => url === query || name === query.toLowerCase());
    if (presetEntry) {
        return {
            title: `📻 Radio: ${presetEntry[0].toUpperCase()}`,
            originalUrl: presetEntry[1],
            durationInSec: 0,
            durationRaw: 'Live',
            sourceType: 'radio'
        };
    }

    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
    
    // Spotify proxy logic
    if (query.includes('spotify.com')) {
        query = await getSpotifyQuery(query);
    }
    
    // Deezer track proxy logic
    if (query.includes('deezer.com/track/')) {
        const trackIdMatch = query.match(/deezer\.com\/(?:\w{2}\/)?track\/(\d+)/);
        if (trackIdMatch) {
            const trackId = trackIdMatch[1];
            try {
                const res = await fetch(`https://api.deezer.com/track/${trackId}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.title && data.artist?.name) {
                        query = `ytsearch1:${data.title} ${data.artist.name}`;
                    }
                }
            } catch (e) {
                console.error("Failed to parse Deezer track:", e.message);
            }
        }
    }
    
    // Apple Music track proxy logic
    if (query.includes('music.apple.com/') && (query.includes('?i=') || query.includes('/song/'))) {
        try {
            const storefrontMatch = query.match(/music\.apple\.com\/(\w{2})\//);
            const storefront = storefrontMatch ? storefrontMatch[1] : 'us';
            let trackId = null;
            const iMatch = query.match(/[\?&]i=(\d+)/);
            if (iMatch) {
                trackId = iMatch[1];
            } else {
                const songMatch = query.match(/\/song\/[^\/]+\/(\d+)/);
                if (songMatch) trackId = songMatch[1];
            }
            if (trackId) {
                const token = await getAppleMusicToken();
                const res = await fetch(`https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${trackId}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Origin': 'https://music.apple.com',
                        'Referer': 'https://music.apple.com/'
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.data && data.data[0]) {
                        const attrs = data.data[0].attributes;
                        query = `ytsearch1:${attrs.name} ${attrs.artistName}`;
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse Apple Music track:", e.message);
        }
    }
    
    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const target = isUrl ? query : `${searchPrefix}${query}`;
    
    try {
        const args = getYtDlpArgs(['-j', '--no-warnings', target]);
        const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) throw new Error("No data returned from yt-dlp.");
        const firstLine = lines[0];
        const data = JSON.parse(firstLine);
        
        return {
            title: data.title || data.fulltitle,
            originalUrl: data.webpage_url || target,
            durationInSec: data.duration,
            durationRaw: data.duration ? `${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}` : 'Live/Unknown',
            sourceType: data.extractor === 'soundcloud' ? 'soundcloud' : (data.extractor === 'youtube' ? 'youtube' : 'other')
        };
    } catch (e) {
        throw new Error(`Failed to extract track info: ${e.message}`);
    }
}

import { ActionRow, Button, Embed } from 'seyfert';

export function getPlayerControls(queue) {
    return new ActionRow().setComponents([
        new Button()
            .setCustomId('player_pause')
            .setLabel(queue.paused ? '▶️ Resume' : '⏸️ Pause')
            .setStyle(queue.paused ? 3 : 1), // 3=Success, 1=Primary
        new Button()
            .setCustomId('player_skip')
            .setLabel('⏭️ Skip')
            .setStyle(2), // 2=Secondary
        new Button()
            .setCustomId('player_loop')
            .setLabel(queue.loopMode === 2 ? '🔁 Loop: Queue' : (queue.loopMode === 1 ? '🔁 Loop: Song' : '🔁 Loop'))
            .setStyle(queue.loopMode !== 0 ? 3 : 2), // 3=Success, 2=Secondary
        new Button()
            .setCustomId('player_stop')
            .setLabel('⏹️ Stop')
            .setStyle(4) // 4=Danger
    ]);
}

export class MusicManager {
    constructor() {
        this.queues = new Map();
    }

    async sendMessage(queue, options) {
        try {
            if (queue.client && queue.textChannelId) {
                await queue.client.messages.write(queue.textChannelId, options);
            }
        } catch (e) {
            console.error("Failed to send message:", e.message);
        }
    }

    updateStatus(songTitle) {
        if (!this.client || process.env.SONG_IN_STATUS !== 'true') return;
        
        if (songTitle) {
            this.client.gateway.setPresence({
                since: null,
                afk: false,
                status: process.env.BOT_STATUS || 'online',
                activities: [{
                    name: songTitle,
                    type: 2 // Listening
                }]
            });
        } else {
            // Restore default
            let activityType = 0; // Default is Playing
            const typeStr = process.env.ACTIVITY_TYPE?.toUpperCase();
            if (typeStr === 'PLAYING') activityType = 0;
            if (typeStr === 'STREAMING') activityType = 1;
            if (typeStr === 'LISTENING') activityType = 2;
            if (typeStr === 'WATCHING') activityType = 3;
            if (typeStr === 'COMPETING') activityType = 5;

            this.client.gateway.setPresence({
                since: null,
                afk: false,
                status: process.env.BOT_STATUS || 'online',
                activities: [{
                    name: process.env.ACTIVITY_NAME || 'music',
                    type: activityType,
                    url: process.env.STREAMING_URL || undefined
                }]
            });
        }
    }

    getQueue(guildId) {
        return this.queues.get(guildId);
    }

    async joinChannel(channel) {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guildId,
            adapterCreator: createSeyfertAdapter(channel.client, channel.guildId),
        });

        return connection;
    }

    pause(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.player) {
            queue.player.pause();
            queue.paused = true;
        }
    }

    resume(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.player) {
            queue.player.unpause();
            queue.paused = false;
        }
    }

    setVolume(guildId, volume) {
        const queue = this.getQueue(guildId);
        if (queue) {
            queue.volume = volume;
            if (queue.resource?.volume) {
                queue.resource.volume.setVolume(volume / 100);
            }
        }
    }

    shuffle(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.songs.length > 1) {
            const current = queue.songs.shift();
            for (let i = queue.songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
            }
            queue.songs.unshift(current);
        }
    }

    clear(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.songs.length > 1) {
            queue.songs.splice(1);
        }
    }

    remove(guildId, index) {
        const queue = this.getQueue(guildId);
        if (queue && index > 0 && index < queue.songs.length) {
            return queue.songs.splice(index, 1)[0];
        }
        return null;
    }

    move(guildId, from, to) {
        const queue = this.getQueue(guildId);
        if (queue && from > 0 && from < queue.songs.length && to > 0 && to < queue.songs.length) {
            const [song] = queue.songs.splice(from, 1);
            queue.songs.splice(to, 0, song);
            return song;
        }
        return null;
    }

    jump(guildId, index) {
        const queue = this.getQueue(guildId);
        if (queue && index > 0 && index < queue.songs.length) {
            queue.songs.splice(1, index - 1);
            queue.player.stop(); // Stops current song, triggers Idle which calls playNext
        }
    }

    async playSongs(channel, songs, textChannel) {
        let guildId = channel.guildId;
        let queue = this.getQueue(guildId);
        
        if (queue) {
            const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE) || 0;
            if (maxQueue > 0 && queue.songs.length >= maxQueue) {
                return textChannel?.write({ content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`, flags: 64 });
            }
        }
        
        if (!queue) {
            const player = createAudioPlayer();
            const connection = await this.joinChannel(channel);

            queue = {
                guildId,
                voiceChannel: channel,
                voiceChannelId: channel.id,
                textChannelId: textChannel.channelId,
                client: channel.client,
                connection,
                player,
                songs: [],
                history: [],
                skipVotes: new Set(),
                playing: false,
                paused: false,
                volume: parseInt(process.env.DEFAULT_VOLUME) || 100,
                loopMode: 0,
                autoplay: false,
                stay247: process.env.STAY_IN_CHANNEL === 'true',
                isSeeking: false,
                seekOffset: 0
            };
            this.queues.set(guildId, queue);

            connection.on('stateChange', (oldState, newState) => {
                console.log(`[VoiceConnection] ${oldState.status} -> ${newState.status}`);
            });
            connection.on('error', err => console.error('[VoiceConnection Error]', err));

            player.on('stateChange', (oldState, newState) => {
                console.log(`[AudioPlayer] ${oldState.status} -> ${newState.status}`);
            });
            player.on('error', err => console.error('[AudioPlayer Error]', err));

            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, async () => {
                if (queue.ytdlpProcess) {
                    if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                    if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') queue.ytdlpProcess.process.kill();
                    queue.ytdlpProcess = null;
                }
                if (queue.isSeeking) {
                    queue.isSeeking = false;
                    this.playNext(guildId);
                } else {
                    const currentSong = queue.songs[0];
                    if (currentSong) {
                        queue.history.push(currentSong);
                        if (queue.history.length > 50) queue.history.shift();
                        
                        if (queue.loopMode === 1) {
                            // Song loop
                        } else if (queue.loopMode === 2) {
                            // Queue loop
                            queue.songs.shift();
                            queue.songs.push(currentSong);
                        } else {
                            // Normal
                            queue.songs.shift();
                        }
                    }
                    
                    if (queue.songs.length > 0) {
                        this.playNext(guildId);
                    } else if (queue.autoplay && currentSong) {
                        try {
                            const relatedTitle = currentSong.title.replace(/[^\w\s]/gi, '').split(' ').slice(0, 4).join(' ');
                            const info = await getTrackInfo(`${relatedTitle} mix`);
                            
                            if (info && info.title) {
                                queue.songs.push({
                                    title: info.title,
                                    url: info.originalUrl,
                                    duration: info.durationRaw,
                                    uploader: 'Autoplay'
                                });
                                this.playNext(guildId);
                            } else {
                                this.handleQueueEnd(guildId, queue);
                            }
                        } catch (e) {
                            this.handleQueueEnd(guildId, queue);
                        }
                    } else {
                        this.handleQueueEnd(guildId, queue);
                    }
                }
            });

            player.on('error', error => {
                console.error(`Audio error: ${error.message}`);
                queue.songs.shift();
                this.playNext(guildId);
            });
        }

        const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE) || 0;
        let addedCount = 0;
        for (const s of songs) {
            if (maxQueue > 0 && queue.songs.length >= maxQueue) {
                break;
            }
            queue.songs.push({
                title: s.title,
                originalUrl: s.originalUrl,
                duration: s.duration,
                sourceType: s.sourceType || 'youtube',
                fallbackStage: 0,
                requesterId: textChannel.member?.id,
                requesterName: textChannel.member?.username || 'Unknown'
            });
            addedCount++;
        }

        try {
            await textChannel?.editOrReply({ content: `✅ Added **${addedCount}** songs to the queue.` });
        } catch (e) {
            await this.sendMessage(queue, { content: `✅ Added **${addedCount}** songs to the queue.` });
        }

        if (!queue.playing) {
            await this.playNext(guildId);
        }
    }

    async play(channel, query, textChannel) {
        let guildId = channel.guildId;
        
        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }
        
        const playlistType = isPlaylist(resolvedQuery);
        
        if (playlistType) {
            try {
                await textChannel?.editOrReply({ content: `🔍 Parsing online playlist...` }).catch(() => {});
            } catch (e) {}

            try {
                let playlistResult;
                if (playlistType === 'spotify_playlist' || playlistType === 'spotify_album') {
                    playlistResult = await fetchSpotifyTracks(resolvedQuery);
                } else if (playlistType === 'apple_playlist' || playlistType === 'apple_album') {
                    playlistResult = await fetchAppleMusicTracks(resolvedQuery);
                } else if (playlistType === 'deezer_playlist' || playlistType === 'deezer_album') {
                    playlistResult = await fetchDeezerTracks(resolvedQuery);
                } else {
                    playlistResult = await fetchYtDlpPlaylistTracks(resolvedQuery);
                }
                
                if (!playlistResult.tracks || playlistResult.tracks.length === 0) {
                    return textChannel?.editOrReply({ content: '❌ The playlist is empty or could not be loaded.' });
                }
                
                try {
                    await textChannel?.editOrReply({ content: `🎵 Loading **${playlistResult.tracks.length}** songs from playlist **${playlistResult.name}**...` }).catch(() => {});
                } catch (e) {}
                
                await this.playSongs(channel, playlistResult.tracks, textChannel);
            } catch (e) {
                console.error("Error loading playlist:", e);
                return textChannel?.editOrReply({ content: `❌ Error loading playlist: ${e.message}` });
            }
            return;
        }

        // Search or get track info
        let trackInfo;
        try {
            trackInfo = await getTrackInfo(resolvedQuery, 'ytsearch1:');
            
            // Limit checks
            const maxDuration = parseInt(process.env.MAX_DURATION) || 0;
            if (maxDuration > 0 && trackInfo.durationInSec > maxDuration) {
                return textChannel?.write({ content: `❌ Song is too long! Maximum allowed duration is \`${maxDuration}s\`.`, flags: 64 });
            }
        } catch (error) {
            console.error("Error fetching track:", error);
            return textChannel?.write({ content: "❌ Could not find or validate that track.", flags: 64 });
        }

        const song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            sourceType: trackInfo.sourceType,
            fallbackStage: 0,
            requesterId: textChannel.member?.id,
            requesterName: textChannel.member?.username || 'Unknown'
        };

        let queue = this.getQueue(guildId);
        
        if (queue) {
            const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE) || 0;
            if (maxQueue > 0 && queue.songs.length >= maxQueue) {
                return textChannel?.write({ content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`, flags: 64 });
            }
        }
        
        if (!queue) {
            const player = createAudioPlayer();
            const connection = await this.joinChannel(channel);

            queue = {
                guildId,
                voiceChannel: channel,
                voiceChannelId: channel.id,
                textChannelId: textChannel.channelId,
                client: channel.client,
                connection,
                player,
                songs: [],
                history: [],
                skipVotes: new Set(),
                playing: false,
                paused: false,
                volume: parseInt(process.env.DEFAULT_VOLUME) || 100,
                loopMode: 0, // 0 = off, 1 = song, 2 = queue
                autoplay: false,
                stay247: process.env.STAY_IN_CHANNEL === 'true',
                isSeeking: false,
                seekOffset: 0,
                ignoreLoopOnce: false
            };
            this.queues.set(guildId, queue);

            connection.on('stateChange', (oldState, newState) => {
                console.log(`[VoiceConnection] ${oldState.status} -> ${newState.status}`);
            });
            connection.on('error', err => console.error('[VoiceConnection Error]', err));

            player.on('stateChange', (oldState, newState) => {
                console.log(`[AudioPlayer] ${oldState.status} -> ${newState.status}`);
            });
            player.on('error', err => console.error('[AudioPlayer Error]', err));

            connection.subscribe(player);

            player.on(AudioPlayerStatus.Idle, async () => {
                if (queue.ytdlpProcess) {
                    if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                    if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') queue.ytdlpProcess.process.kill();
                    queue.ytdlpProcess = null;
                }
                if (queue.isSeeking) {
                    queue.isSeeking = false;
                    this.playNext(guildId);
                } else {
                    const currentSong = queue.songs[0];
                    if (currentSong) {
                        queue.history.push(currentSong);
                        if (queue.history.length > 50) queue.history.shift();
                        
                        if (queue.loopMode === 1 && !queue.ignoreLoopOnce) {
                            // Song loop, do not shift
                        } else if (queue.loopMode === 2) {
                            if (queue.ignoreLoopOnce) queue.ignoreLoopOnce = false;
                            // Queue loop
                            queue.songs.shift();
                            queue.songs.push(currentSong);
                        } else {
                            if (queue.ignoreLoopOnce) queue.ignoreLoopOnce = false;
                            // Normal
                            queue.songs.shift();
                        }
                    }
                    
                    if (queue.songs.length > 0) {
                        this.playNext(guildId);
                    } else if (queue.autoplay && currentSong) {
                        try {
                            const relatedTitle = currentSong.title.replace(/[^\w\s]/gi, '').split(' ').slice(0, 4).join(' ');
                            const info = await getTrackInfo(`${relatedTitle} mix`);
                            
                            if (info && info.title) {
                                queue.songs.push({
                                    title: info.title,
                                    url: info.originalUrl,
                                    duration: info.durationRaw,
                                    uploader: 'Autoplay'
                                });
                                this.playNext(guildId);
                            } else {
                                this.handleQueueEnd(guildId, queue);
                            }
                        } catch (e) {
                            this.handleQueueEnd(guildId, queue);
                        }
                    } else {
                        this.handleQueueEnd(guildId, queue);
                    }
                }
            });

            player.on('error', error => {
                console.error(`Audio error: ${error.message}`);
                queue.songs.shift();
                this.playNext(guildId);
            });
        }

        queue.songs.push(song);
        try {
            await textChannel?.editOrReply({ content: `🎵 Added to queue: **${song.title}**` });
        } catch (e) {
            await this.sendMessage(queue, { content: `🎵 Added to queue: **${song.title}**` });
        }

        if (!queue.playing) {
            await this.playNext(guildId);
        }
    }

    seek(guildId, seconds) {
        const queue = this.getQueue(guildId);
        if (queue && queue.playing && queue.songs.length > 0) {
            queue.seekOffset = seconds;
            // Re-play the current song with the new offset
            // We temporarily disable the Idle event handling by setting a flag
            queue.isSeeking = true;
            queue.player.stop();
            // The Idle event will fire, but we'll intercept it
        }
    }

    async prefetchNextTrack(guildId, nextSong) {
        if (!nextSong || nextSong.sourceType === 'radio' || nextSong.isRadio || nextSong.prefetchFilePath || nextSong.isPrefetching) {
            return;
        }
        
        nextSong.isPrefetching = true;
        const os = require('os');
        const path = require('path');
        const tempFilePath = path.join(os.tmpdir(), `discord_music_prefetch_${guildId}_${Date.now()}.audio`);
        
        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const ytdlpArgs = getYtDlpArgs(['-f', 'bestaudio', '-o', '-', '--no-warnings', nextSong.originalUrl]);
            const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });
            
            // Large 8MB buffer for HDD sequential write optimization (minimizes HDD head thrashing)
            const fileStream = fs.createWriteStream(tempFilePath, { highWaterMark: 1024 * 1024 * 8 });
            ytdlpChildProcess.stdout.pipe(fileStream);
            
            nextSong.prefetchFilePath = tempFilePath;
            nextSong.prefetchProcess = ytdlpChildProcess;
            
            ytdlpChildProcess.on('close', () => {
                nextSong.isPrefetching = false;
            });
        } catch (e) {
            nextSong.isPrefetching = false;
            logger.error('Prefetch', 'Failed to prefetch next track', e);
        }
    }

    async playNext(guildId) {
        const queue = this.getQueue(guildId);
        if (!queue) return;

        const song = queue.songs[0];
        
        // Clear votes on next song
        queue.skipVotes.clear();
        
        if (!song) {
            return this.handleQueueEnd(guildId, queue);
        }

        try {
            let streamUrl = song.originalUrl;
            let userAgent = "Mozilla/5.0";

            // If it's a direct radio preset/stream URL, bypass yt-dlp lookup
            const isDirectRadioStream = song.sourceType === 'radio' || song.isRadio || /\.(mp3|ogg|aac|wav|flac|m4a)(\?|$)/i.test(song.originalUrl) || /streams\.ilovemusic\.de|streaming\.radio\.co|live\.musopen\.org|streams\.fluxfm\.de|radio\.synth\.fm|stream\.radioseda\.ir/i.test(song.originalUrl);

            let ffmpegArgs = [];
            let inputSource = null;
            let tempFilePath = null;

            // Cleanup previous processes and temp files early to save memory
            if (queue.ytdlpProcess) {
                if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') queue.ytdlpProcess.process.kill();
                queue.ytdlpProcess = null;
            }
            if (queue.ytdlpChildProcess && queue.ytdlpChildProcess !== song.prefetchProcess) {
                queue.ytdlpChildProcess.kill();
                queue.ytdlpChildProcess = null;
            }
            if (queue.tempFilePath && queue.tempFilePath !== song.prefetchFilePath) {
                fsPromises.unlink(queue.tempFilePath).catch(() => {});
                queue.tempFilePath = null;
            }

            if (!isDirectRadioStream) {
                // AUDIO PREFETCHING & BUFFERING OPTIMIZATION
                const os = require('os');
                const path = require('path');
                
                if (song.prefetchFilePath) {
                    // Use the already background-prefetched file (HDD read optimization)
                    logger.info('Prefetch', `Using prefetched audio file for: ${song.title}`);
                    tempFilePath = song.prefetchFilePath;
                    queue.tempFilePath = tempFilePath;
                    queue.ytdlpChildProcess = song.prefetchProcess || null;
                } else {
                    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
                    tempFilePath = path.join(os.tmpdir(), `discord_music_${guildId}_${Date.now()}.audio`);
                    queue.tempFilePath = tempFilePath;
                    
                    const ytdlpArgs = getYtDlpArgs(['-f', 'bestaudio', '-o', '-', '--no-warnings', song.originalUrl]);
                    const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });
                    queue.ytdlpChildProcess = ytdlpChildProcess;
                    
                    // Large 8MB buffer for HDD sequential write optimization to prevent disk thrashing
                    const fileStream = fs.createWriteStream(tempFilePath, { highWaterMark: 1024 * 1024 * 8 });
                    ytdlpChildProcess.stdout.pipe(fileStream);
                    
                    // Wait for the download to buffer a bit
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }

                // Optimized FFmpeg pipeline for native hardware-aligned instructions (Stereo, 48000Hz PCM/Opus)
                ffmpegArgs = [
                    '-hide_banner',
                    '-threads', '0', // Allow FFmpeg to optimize thread count for CPU (e.g., ProLiant)
                    '-i', tempFilePath, // Read from our temp file
                    '-analyzeduration', '0',
                    '-loglevel', 'warning',
                    '-vn',           // Drop video tracks completely
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    // Use high-quality soxr resampler to minimize CPU overhead on mismatching sample rates
                    '-af', 'aresample=resampler=soxr:precision=28'
                ];
            } else {
                // Direct radio streams cannot be prefetched to EOF (they are infinite)
                ffmpegArgs = [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-user_agent', userAgent,
                    '-i', streamUrl,
                    '-analyzeduration', '0',
                    '-loglevel', 'warning',
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    // Retain native hardware alignment optimizations for radio streams too
                    '-af', 'aresample=resampler=soxr:precision=28'
                ];
            }

            const ffmpegProcess = new prism.FFmpeg({ args: ffmpegArgs });
            
            ffmpegProcess.process.on('error', err => logger.error('FFmpeg', 'Process Error', err));
            ffmpegProcess.process.stderr.on('data', data => logger.debug('FFmpeg', `STDERR: ${data.toString().trim()}`));
            ffmpegProcess.process.on('exit', code => logger.debug('FFmpeg', `Process exited with code ${code}`));
            
            queue.ytdlpProcess = ffmpegProcess; // Keeping same variable name for compatibility with cleanup

            if (inputSource) {
                // Pipe the prefetched memory buffer into FFmpeg
                inputSource.pipe(ffmpegProcess.process.stdin);
                // Handle stream errors silently
                inputSource.on('error', () => {}); 
                ffmpegProcess.process.stdin.on('error', () => {});
            }

            const resource = createAudioResource(ffmpegProcess, {
                inputType: StreamType.Raw,
                inlineVolume: true
            });
            
            resource.volume.setVolume(queue.volume / 100);
            queue.resource = resource;

            queue.player.play(resource);
            queue.playing = true;
            queue.paused = false;
            
            const settings = loadSettings(guildId);
            if (settings.announceNowPlaying !== false) {
                const embed = new Embed()
                    .setTitle(`▶️ Now Playing`)
                    .setDescription(`**[${song.title}](${song.originalUrl})**`)
                    .setColor('#5865F2')
                    .setFooter({ text: `Duration: ${song.duration}` });
                    
                await this.sendMessage(queue, { 
                    embeds: [embed],
                    components: [getPlayerControls(queue)]
                });
            }
            this.updateStatus(song.title);
            
            // HDD Optimization: Background prefetch the next track in the queue to a separate temp file
            // This prevents playback gap and uses the 350Mbps bandwidth effectively without thrashing the HDD
            if (queue.songs.length > 1) {
                this.prefetchNextTrack(guildId, queue.songs[1]);
            }
        } catch (error) {
            console.error(`Failed to play ${song.title}:`, error);
            
            // Double-Layered Fallback Logic
            if (song.fallbackStage === 0) {
                song.fallbackStage = 1;
                
                if (song.sourceType === 'soundcloud') {
                    await this.sendMessage(queue, { content: `⚠️ SoundCloud stream failed, attempting YouTube fallback for **${song.title}**...` });
                    try {
                        const fallbackInfo = await getTrackInfo(song.title, 'ytsearch1:');
                        song.originalUrl = fallbackInfo.originalUrl;
                        return this.playNext(guildId);
                    } catch (fallbackError) {
                        console.error("YouTube fallback search failed:", fallbackError);
                    }
                } else if (song.sourceType === 'youtube' || song.sourceType === 'other') {
                    await this.sendMessage(queue, { content: `⚠️ Stream failed, attempting SoundCloud fallback for **${song.title}**...` });
                    try {
                        // For SoundCloud fallback, we explicitly target SoundCloud via yt-dlp
                        const fallbackInfo = await getTrackInfo(`scsearch1:${song.title}`);
                        song.originalUrl = fallbackInfo.originalUrl;
                        return this.playNext(guildId);
                    } catch (fallbackError) {
                        console.error("SoundCloud fallback search failed:", fallbackError);
                    }
                }
            }
            
            await this.sendMessage(queue, { content: `❌ Could not play **${song.title}** after all fallbacks (skipping to next...)` });
            
            // Auto skip to the next song if streaming fails
            queue.songs.shift();
            
            // Push to history since it skipped
            if (song) {
                queue.history.push(song);
                if (queue.history.length > 50) queue.history.shift();
            }
            
            if (queue.songs.length > 0) {
                this.playNext(guildId);
            } else {
                this.handleQueueEnd(guildId, queue);
            }
        }
    }

    handleQueueEnd(guildId, queue) {
        queue.playing = false;
        this.updateStatus(null);
        if (!queue.stay247) {
            const timeoutSecs = parseInt(process.env.IDLE_TIMEOUT) || 60;
            if (timeoutSecs > 0) {
                setTimeout(async () => {
                    const currentQueue = this.getQueue(guildId);
                    if (currentQueue && !currentQueue.playing) {
                        await this.sendMessage(currentQueue, { content: '👋 Left the voice channel due to inactivity.' });
                        this.leave(guildId);
                    }
                }, timeoutSecs * 1000);
            }
        }
    }

    skip(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.player) {
            queue.player.stop(); // triggers Idle event
        }
    }

    previous(guildId) {
        const queue = this.getQueue(guildId);
        if (queue && queue.history.length > 0) {
            const currentSong = queue.songs[0];
            const previousSong = queue.history.pop();
            
            // Insert current back to queue (as next) and put previous at front
            if (currentSong) {
                queue.songs.unshift(previousSong);
            } else {
                queue.songs.push(previousSong);
            }
            queue.player.stop(); // triggers Idle and plays what's at index 0
        }
    }

    async forcePlay(channel, query, textChannel) {
        const guildId = channel.guildId;
        const queue = this.getQueue(guildId);
        
        if (!queue) {
            return this.play(channel, query, textChannel);
        }
        
        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }
        
        const playlistType = isPlaylist(resolvedQuery);
        if (playlistType) {
            let playlistResult;
            if (playlistType === 'spotify_playlist' || playlistType === 'spotify_album') {
                playlistResult = await fetchSpotifyTracks(resolvedQuery);
            } else if (playlistType === 'apple_playlist' || playlistType === 'apple_album') {
                playlistResult = await fetchAppleMusicTracks(resolvedQuery);
            } else if (playlistType === 'deezer_playlist' || playlistType === 'deezer_album') {
                playlistResult = await fetchDeezerTracks(resolvedQuery);
            } else {
                playlistResult = await fetchYtDlpPlaylistTracks(resolvedQuery);
            }
            
            if (!playlistResult.tracks || playlistResult.tracks.length === 0) {
                return textChannel?.editOrReply({ content: '❌ The playlist is empty or could not be loaded.' });
            }
            
            const songs = playlistResult.tracks.map(t => ({
                title: t.title,
                originalUrl: t.originalUrl,
                duration: t.durationRaw || t.duration,
                sourceType: t.sourceType || 'youtube',
                fallbackStage: 0,
                requesterId: textChannel.member?.id,
                requesterName: textChannel.member?.username || 'Unknown'
            }));
            
            queue.songs.splice(1, 0, ...songs);
            queue.ignoreLoopOnce = true;
            this.skip(guildId);
            
            try {
                await textChannel?.editOrReply({ content: `⚡ Force playing playlist: **${playlistResult.name}** (${songs.length} songs)` });
            } catch (e) {
                await this.sendMessage(queue, { content: `⚡ Force playing playlist: **${playlistResult.name}** (${songs.length} songs)` });
            }
            return;
        }
        
        const trackInfo = await getTrackInfo(resolvedQuery, 'ytsearch1:');
        const song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            sourceType: trackInfo.sourceType,
            fallbackStage: 0,
            requesterId: textChannel.member?.id,
            requesterName: textChannel.member?.username || 'Unknown'
        };
        
        queue.songs.splice(1, 0, song);
        queue.ignoreLoopOnce = true;
        this.skip(guildId);
        
        try {
            await textChannel?.editOrReply({ content: `⚡ Force playing: **${song.title}**` });
        } catch (e) {
            await this.sendMessage(queue, { content: `⚡ Force playing: **${song.title}**` });
        }
    }

    async playNextSong(channel, query, textChannel) {
        const guildId = channel.guildId;
        const queue = this.getQueue(guildId);
        
        if (!queue) {
            return this.play(channel, query, textChannel);
        }
        
        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }
        
        const playlistType = isPlaylist(resolvedQuery);
        if (playlistType) {
            let playlistResult;
            if (playlistType === 'spotify_playlist' || playlistType === 'spotify_album') {
                playlistResult = await fetchSpotifyTracks(resolvedQuery);
            } else if (playlistType === 'apple_playlist' || playlistType === 'apple_album') {
                playlistResult = await fetchAppleMusicTracks(resolvedQuery);
            } else if (playlistType === 'deezer_playlist' || playlistType === 'deezer_album') {
                playlistResult = await fetchDeezerTracks(resolvedQuery);
            } else {
                playlistResult = await fetchYtDlpPlaylistTracks(resolvedQuery);
            }
            
            if (!playlistResult.tracks || playlistResult.tracks.length === 0) {
                return textChannel?.editOrReply({ content: '❌ The playlist is empty or could not be loaded.' });
            }
            
            const songs = playlistResult.tracks.map(t => ({
                title: t.title,
                originalUrl: t.originalUrl,
                duration: t.durationRaw || t.duration,
                sourceType: t.sourceType || 'youtube',
                fallbackStage: 0,
                requesterId: textChannel.member?.id,
                requesterName: textChannel.member?.username || 'Unknown'
            }));
            
            queue.songs.splice(1, 0, ...songs);
            try {
                await textChannel?.editOrReply({ content: `⏭️ Added playlist to play next: **${playlistResult.name}** (${songs.length} songs)` });
            } catch (e) {
                await this.sendMessage(queue, { content: `⏭️ Added playlist to play next: **${playlistResult.name}** (${songs.length} songs)` });
            }
            return;
        }
        
        const trackInfo = await getTrackInfo(resolvedQuery, 'ytsearch1:');
        const song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            sourceType: trackInfo.sourceType,
            fallbackStage: 0,
            requesterId: textChannel.member?.id,
            requesterName: textChannel.member?.username || 'Unknown'
        };
        
        queue.songs.splice(1, 0, song);
        try {
            await textChannel?.editOrReply({ content: `⏭️ Added to play next: **${song.title}**` });
        } catch (e) {
            await this.sendMessage(queue, { content: `⏭️ Added to play next: **${song.title}**` });
        }
    }

    leave(guildId) {
        const queue = this.getQueue(guildId);
        if (queue) {
            try {
                if (queue.player) queue.player.stop();
                if (queue.connection) queue.connection.destroy();
                if (queue.ytdlpProcess) {
                    if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                    if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') queue.ytdlpProcess.process.kill();
                }
                if (queue.ytdlpChildProcess) queue.ytdlpChildProcess.kill();
                if (queue.tempFilePath) {
                    fsPromises.unlink(queue.tempFilePath).catch(() => {});
                }
                if (queue.songs) {
                    for (const s of queue.songs) {
                        if (s.prefetchProcess) s.prefetchProcess.kill();
                        if (s.prefetchFilePath) fsPromises.unlink(s.prefetchFilePath).catch(() => {});
                    }
                }
            } catch (e) {}
            this.queues.delete(guildId);
        } else {
            const connection = getVoiceConnection(guildId);
            if (connection) connection.destroy();
        }
    }
}

export const musicManager = new MusicManager();

// Graceful shutdown hooks
const cleanup = () => {
    logger.info('System', 'Cleaning up active music engine allocations...');
    for (const [guildId, queue] of musicManager.queues.entries()) {
        try {
            if (queue.connection) queue.connection.destroy();
            if (queue.ytdlpChildProcess) queue.ytdlpChildProcess.kill();
            if (queue.ytdlpProcess?.process) queue.ytdlpProcess.process.kill();
            if (queue.tempFilePath && fs.existsSync(queue.tempFilePath)) {
                fs.unlinkSync(queue.tempFilePath);
            }
            if (queue.songs) {
                for (const s of queue.songs) {
                    if (s.prefetchProcess) s.prefetchProcess.kill();
                    if (s.prefetchFilePath && fs.existsSync(s.prefetchFilePath)) {
                        fs.unlinkSync(s.prefetchFilePath);
                    }
                }
            }
        } catch (e) {}
    }
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
