import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
    StreamType,
    entersState
} from '@discordjs/voice';
import { execFile, spawn, spawnSync } from 'child_process';
import prism from 'prism-media';
import { promisify } from 'util';

// Shared async exec helper — also used by commands via import
export const execFileAsync = promisify(execFile);
import { getYtDlpArgs } from '../utils/cookies.js';
import { loadSettings } from './serverSettings.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';

export let ffmpegInfo = {
    type: 'unknown',
    path: 'unknown',
    version: 'unknown',
};

// Hardware Optimization Evaluator
export const hardwareOptimization = (() => {
    const totalRamGB = os.totalmem() / 1024 / 1024 / 1024;
    const cpuCores = os.cpus().length;
    const diskType = process.env.SYSTEM_DISK_TYPE?.toLowerCase() || 'auto';
    
    let bufferSizeMB = 8;
    if (process.env.STREAM_BUFFER_SIZE) {
        bufferSizeMB = parseInt(process.env.STREAM_BUFFER_SIZE);
    } else if (diskType === 'ssd' || diskType === 'nvme') {
        bufferSizeMB = 2; // Fast random writes, smaller buffer needed (saves RAM)
    } else if (diskType === 'hdd') {
        bufferSizeMB = 16; // Minimize HDD head thrashing with larger sequential chunks
    } else {
        bufferSizeMB = totalRamGB >= 8 ? 16 : 8; // Auto guess based on Total RAM
    }

    let threads = process.env.FFMPEG_THREADS?.toLowerCase() || 'auto';
    if (threads === 'auto') {
        threads = cpuCores <= 4 ? '1' : '2'; // Audio transcoding doesn't scale well past 2 threads
    }

    logger.info('Optimization', `Profile applied: ${threads} FFmpeg threads | ${bufferSizeMB}MB Stream Buffer | Disk: ${diskType} | Cores: ${cpuCores} | RAM: ${totalRamGB.toFixed(1)}GB`);

    return {
        threads: threads.toString(),
        bufferSize: bufferSizeMB * 1024 * 1024,
        bufferSizeMB,
        diskType
    };
})();

// Configure FFmpeg path and version safely without mutating imported modules.
// This makes the info available to other parts of the bot, like the /stats command.
try {
    const customFfmpeg = process.env.FFMPEG_PATH;
    let result;
    
    if (customFfmpeg) {
        result = spawnSync(customFfmpeg, ['-version'], { windowsHide: true });
        if (!result.error && result.stdout) {
            ffmpegInfo.type = 'custom';
            ffmpegInfo.path = customFfmpeg;
            logger.info('FFmpeg', `Using custom FFmpeg from env: ${customFfmpeg}`);
        } else {
            logger.warn('FFmpeg', `Custom FFmpeg path (${customFfmpeg}) is invalid, falling back...`);
        }
    }

    if (!ffmpegInfo.path || ffmpegInfo.path === 'unknown') { // If custom path was not valid or not provided
        result = spawnSync('ffmpeg', ['-version'], { windowsHide: true });
        if (!result.error && result.stdout) {
            ffmpegInfo.type = 'system ffmpeg';
            ffmpegInfo.path = 'ffmpeg';
            logger.info('FFmpeg', 'System FFmpeg found! Using it directly instead of ffmpeg-static.');
        } else {
            const staticInfo = (prism.default?.FFmpeg || prism.FFmpeg).getInfo();
            ffmpegInfo.type = 'ffmpeg-static';
            ffmpegInfo.path = staticInfo.command;
            result = { stdout: staticInfo.output }; // Use static's output for version parsing
            logger.info('FFmpeg', 'System FFmpeg not found, falling back to ffmpeg-static.');
        }
    }

    const output = result?.stdout?.toString() || '';
    const match = /version\s+([^\s]+)/.exec(output) || /version ([^\s]+) Copyright/.exec(output);
    ffmpegInfo.version = match ? match[1].replace(/-\w+$/, '') : 'unknown'; // Clean version string
    logger.debug('FFmpeg', `Detected Version: ${ffmpegInfo.version}`);

    // Inject the resolved FFmpeg path into prism-media so it is used during playback
    const prismFfmpeg = prism.default?.FFmpeg || prism.FFmpeg;
    if (prismFfmpeg) {
        prismFfmpeg.getInfo = () => ({
            command: ffmpegInfo.path,
            output: output,
            version: ffmpegInfo.version
        });
    }
} catch (e) {
    logger.error('FFmpeg', 'Error configuring FFmpeg path, using fallback.', e.message || e);
    // Even if it failed, attempt to assign something so it doesn't crash prism
    ffmpegInfo.path = ffmpegInfo.path !== 'unknown' ? ffmpegInfo.path : 'ffmpeg';
}

// execFileAsync is now exported above alongside imports for reuse by commands

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
                logger.debug('Voice', `Payload [op:${payload.op}] -> shard ${shardId} for guild ${guildId}`);
                client.gateway.send(shardId, payload);
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
    try {
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
    } catch (e) {
        logger.warn('Spotify', `Scraping failed (${e.message}), falling back to yt-dlp native extraction.`);
        return await fetchYtDlpPlaylistTracks(url);
    }
}

let cachedAppleToken = null;
let appleTokenExpiry = 0;
let appleTokenPromise = null;

async function getAppleMusicToken() {
    if (cachedAppleToken && Date.now() < appleTokenExpiry) {
        return cachedAppleToken;
    }

    // Promise-based lock: all concurrent callers share the same in-flight request
    if (appleTokenPromise) {
        return appleTokenPromise;
    }

    appleTokenPromise = (async () => {
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
    })();

    try {
        return await appleTokenPromise;
    } finally {
        appleTokenPromise = null;
    }
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
        logger.error('Redirect', 'Failed to resolve URL redirects', e);
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
        rawTracks = tracksRelationship.data.slice();
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
                    rawTracks.push(...nextData.data);
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
    const args = getYtDlpArgs(['-j', '--flat-playlist', '--socket-timeout', '15', '--no-warnings', url]);
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
            sourceType: data.extractor === 'soundcloud' ? 'soundcloud' : 'youtube',
            // flat-playlist results only contain webpage URLs, not audio stream URLs.
            // Omit _ytDlpData so playNext() triggers a full metadata fetch before streaming.
            _ytDlpData: null
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
    } catch(e) { logger.debug('Spotify', 'Failed to scrape Spotify title', e); }
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
                logger.error('Deezer', 'Failed to parse Deezer track', e);
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
            logger.error('AppleMusic', 'Failed to parse Apple Music track', e);
        }
    }
    
    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const target = isUrl ? query : `${searchPrefix}${query}`;
    
    const maxRetries = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const args = getYtDlpArgs([
                '-j', 
                '-f', '251/bestaudio/best',
                '--socket-timeout', '15', 
                '--no-warnings', 
                target
            ]);
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
                sourceType: data.extractor === 'soundcloud' ? 'soundcloud' : (data.extractor === 'youtube' ? 'youtube' : 'other'),
                // Keep fields needed for streaming, codec detection (Opus passthrough), and /debug info
                _ytDlpData: { 
                    url: data.url, 
                    extractor: data.extractor, 
                    webpage_url: data.webpage_url, 
                    acodec: data.acodec, 
                    format_id: data.format_id, 
                    asr: data.asr, 
                    audio_channels: data.audio_channels,
                    abr: data.abr || data.tbr,
                    ext: data.ext,
                    protocol: data.protocol
                }
            };
        } catch (e) {
            lastError = e;
            if (attempt < maxRetries) {
                logger.warn('TrackInfo', `Attempt ${attempt} failed for ${target}, retrying... (${e.message})`);
                await new Promise(res => setTimeout(res, 2000 * attempt)); // Backoff: 2s, 4s
            }
        }
    }
    
    throw new Error(`Failed to extract track info after ${maxRetries} attempts: ${lastError.message}`);
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

    _cleanupSong(song) {
        if (!song) return;
        // Clean up the prefetch process if it's still running
        if (song.prefetchProcess) {
            song.prefetchProcess.kill();
            song.prefetchProcess = null;
            logger.debug('Prefetch', `Killed prefetch process for: ${song.title}`);
        }
        // Clean up the temporary file from prefetching
        if (song.prefetchFilePath) {
            fsPromises.unlink(song.prefetchFilePath).catch(err => logger.warn('Prefetch', `Failed to delete prefetch file ${song.prefetchFilePath}: ${err.message}`));
            song.prefetchFilePath = null;
        }
        if (song._currentFilePath) {
            fsPromises.unlink(song._currentFilePath).catch(() => {});
            song._currentFilePath = null;
        }
    }

    async sendMessage(queue, options) {
        try {
            if (queue.client && queue.textChannelId) {
                return await queue.client.messages.write(queue.textChannelId, options);
            }
        } catch (e) {
            logger.error('MusicManager', 'Failed to send message', e);
        }
        return null;
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

    async _ensureQueue(channel, textChannel) {
        const guildId = channel.guildId;
        let queue = this.getQueue(guildId);

        if (queue) {
            return queue;
        }

        const player = createAudioPlayer();
        const connection = await this.joinChannel(channel);

        // Wait for the connection to be ready before proceeding to prevent race conditions.
        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000); // 30s timeout
        } catch (error) {
            logger.error('VoiceConnection', `Connection failed to enter Ready state within 30s for guild ${guildId}`, error);
            connection.destroy();
            this.queues.delete(guildId);
            throw new Error('Could not connect to the voice channel in time.');
        }

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

            loopMode: 0, // 0 = off, 1 = song, 2 = queue
            autoplay: false,
            stay247: process.env.STAY_IN_CHANNEL === 'true',
            isSeeking: false,
            seekOffset: 0,
            ignoreLoopOnce: false
        };
        this.queues.set(guildId, queue);

        connection.on('stateChange', (oldState, newState) => {
            logger.debug('VoiceConnection', `${oldState.status} -> ${newState.status}`);
        });
        connection.on('error', err => logger.error('VoiceConnection', 'Connection error', err));

        // Reconnection strategy: attempt to recover from network disconnects
        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                // Wait for the connection to re-enter Signalling or Connecting state
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
                logger.info('VoiceConnection', `Reconnecting voice for guild ${guildId}...`);
            } catch {
                // Could not reconnect within 5 seconds — destroy and clean up
                logger.warn('VoiceConnection', `Failed to reconnect voice for guild ${guildId}, destroying connection.`);
                connection.destroy();
                this.queues.delete(guildId);
            }
        });

        player.on('stateChange', (oldState, newState) => {
            logger.debug('AudioPlayer', `${oldState.status} -> ${newState.status}`);
        });
        // Error handling is done by the dedicated handler below (line ~913)

        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, async () => {
            // Guard against duplicate/spurious Idle events (e.g. FFmpeg EOF + AudioPlayer transition)
            const now = Date.now();
            if (queue.lastIdleTime && (now - queue.lastIdleTime) < 500) {
                logger.debug('AudioPlayer', `Ignoring duplicate Idle event (${now - queue.lastIdleTime}ms since last)`);
                return;
            }
            queue.lastIdleTime = now;

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
                                originalUrl: info.originalUrl,
                                duration: info.durationRaw,
                                sourceType: info.sourceType || 'youtube',
                                _ytDlpData: info._ytDlpData || null,
                                fallbackStage: 0,
                                requesterId: null,
                                requesterName: 'Autoplay'
                            });
                            this.playNext(guildId);
                        } else { this.handleQueueEnd(guildId, queue); }
                    } catch (e) { this.handleQueueEnd(guildId, queue); }
                } else { this.handleQueueEnd(guildId, queue); }
            }
        });

        player.on('error', error => {
            logger.error('AudioPlayer', `Audio error: ${error.message}`);
            queue.songs.shift();
            this.playNext(guildId);
        });

        return queue;
    }

    async playSongs(channel, songs, textChannel) {
        let guildId = channel.guildId;
        const queue = await this._ensureQueue(channel, textChannel);

        const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE) || 0;
        let addedCount = 0;
        if (maxQueue > 0 && queue.songs.length >= maxQueue) {
            return textChannel?.editOrReply({ content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`, flags: 64 });
        }

        for (const s of songs) {
            if (maxQueue > 0 && queue.songs.length >= maxQueue) {
                break;
            }
            queue.songs.push({
                title: s.title,
                originalUrl: s.originalUrl,
                duration: s.duration,
                sourceType: s.sourceType || 'youtube',
                _ytDlpData: s._ytDlpData || null,
                fallbackStage: 0,
                requesterId: textChannel.member?.id,
                requesterName: textChannel.member?.username || 'Unknown'
            });
            addedCount++;
        }

        await textChannel?.editOrReply({ content: `✅ Added **${addedCount}** songs to the queue.` }).catch(() => this.sendMessage(queue, { content: `✅ Added **${addedCount}** songs to the queue.` }));

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
                let playlistResult;
                if (playlistType === 'spotify_playlist' || playlistType === 'spotify_album') {
                    playlistResult = await fetchSpotifyTracks(resolvedQuery); // This is a placeholder, assuming you have this function
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
                
                await textChannel?.editOrReply({ content: `🎵 Loading **${playlistResult.tracks.length}** songs from playlist **${playlistResult.name}**...` }).catch(() => {});
                
                await this.playSongs(channel, playlistResult.tracks, textChannel);
            } catch (e) {
                logger.error('MusicManager', 'Error loading playlist', e);
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
                return textChannel?.editOrReply({ content: `❌ Song is too long! Maximum allowed duration is \`${maxDuration}s\`.`, flags: 64 });
            }
        } catch (error) {
            logger.error('MusicManager', 'Error fetching track', error);
            return textChannel?.editOrReply({ content: "❌ Could not find or validate that track.", flags: 64 });
        }

        const song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            sourceType: trackInfo.sourceType,
            _ytDlpData: trackInfo._ytDlpData || null,
            fallbackStage: 0,
            requesterId: textChannel.member?.id,
            requesterName: textChannel.member?.username || 'Unknown'
        };

        const queue = await this._ensureQueue(channel, textChannel);

        const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE) || 0;
        if (maxQueue > 0 && queue.songs.length >= maxQueue) {
            return textChannel?.editOrReply({ content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`, flags: 64 });
        }

        queue.songs.push(song);
        await textChannel?.editOrReply({ content: `🎵 Added to queue: **${song.title}**` }).catch(() => this.sendMessage(queue, { content: `🎵 Added to queue: **${song.title}**` }));

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
        const tempFilePath = path.join(os.tmpdir(), `discord_music_prefetch_${guildId}_${Date.now()}.audio`);
        nextSong.prefetchFilePath = tempFilePath; // Set immediately so playNext can find it if still running
        
        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const ytdlpArgs = getYtDlpArgs([
                '-f', '251/bestaudio/best',
                '-o', tempFilePath, 
                '--no-part', 
                '--print-json',
                '--buffer-size', `${hardwareOptimization.bufferSizeMB}M`, 
                '--socket-timeout', '15', 
                '--no-warnings', 
                nextSong.originalUrl
            ]);
            const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });
            
            // Store process reference for cleanup (leave/stop)
            nextSong.prefetchProcess = ytdlpChildProcess;

            // Capture stdout JSON metadata for codec detection (acodec, format_id)
            let stdoutChunks = [];
            ytdlpChildProcess.stdout.on('data', (data) => {
                stdoutChunks.push(data);
            });
            
            ytdlpChildProcess.stderr.on('data', (data) => {
                logger.debug('Prefetch', `[${nextSong.title}] STDERR: ${data.toString().trim()}`);
            });

            ytdlpChildProcess.on('close', async (code) => {
                nextSong.isPrefetching = false;

                if (code === 0) {
                    try {
                        const stats = await fsPromises.stat(tempFilePath).catch(() => null);
                        if (stats && stats.size > 1024) {
                            // Parse yt-dlp JSON to populate _ytDlpData (needed for Opus passthrough detection)
                            try {
                                const jsonStr = Buffer.concat(stdoutChunks).toString();
                                const metadata = JSON.parse(jsonStr);
                                if (!nextSong._ytDlpData) {
                                    nextSong._ytDlpData = metadata;
                                } else {
                                    // Merge codec & stream info without overwriting existing data
                                    nextSong._ytDlpData.acodec = metadata.acodec || nextSong._ytDlpData.acodec;
                                    nextSong._ytDlpData.format_id = metadata.format_id || nextSong._ytDlpData.format_id;
                                    nextSong._ytDlpData.asr = metadata.asr || nextSong._ytDlpData.asr;
                                    nextSong._ytDlpData.audio_channels = metadata.audio_channels || nextSong._ytDlpData.audio_channels;
                                    nextSong._ytDlpData.abr = metadata.abr || metadata.tbr || nextSong._ytDlpData.abr;
                                    nextSong._ytDlpData.ext = metadata.ext || nextSong._ytDlpData.ext;
                                    nextSong._ytDlpData.protocol = metadata.protocol || nextSong._ytDlpData.protocol;
                                }
                            } catch (e) {
                                // JSON parse failed — not critical, codec detection will fall back to transcode
                                logger.debug('Prefetch', `Could not parse yt-dlp metadata for ${nextSong.title}`);
                            }

                            const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                            logger.info('Prefetch', `Ready: ${nextSong.title} (${sizeMB} MB)`);
                        } else {
                            // File missing or too small despite exit code 0
                            nextSong.prefetchProcess = null;
                            fsPromises.unlink(tempFilePath).catch(() => {});
                            logger.debug('Prefetch', `File missing/empty after successful exit for: ${nextSong.title}`);
                        }
                    } catch (e) {
                        nextSong.prefetchProcess = null;
                        logger.debug('Prefetch', `Post-download check failed for ${nextSong.title}: ${e.message}`);
                    }
                } else {
                    // Download failed — clean up and let the normal download path handle it later
                    nextSong.prefetchProcess = null;
                    nextSong.prefetchFilePath = null;
                    fsPromises.unlink(tempFilePath).catch(() => {});
                    logger.debug('Prefetch', `Failed (exit code ${code}): ${nextSong.title}`);
                }
                stdoutChunks = null; // Free memory
            });

            ytdlpChildProcess.on('error', (err) => {
                nextSong.isPrefetching = false;
                nextSong.prefetchProcess = null;
                logger.debug('Prefetch', `Process error for ${nextSong.title}: ${err.message}`);
            });
        } catch (e) {
            nextSong.isPrefetching = false;
            nextSong.prefetchProcess = null;
            logger.error('Prefetch', 'Failed to start prefetch', e);
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

        queue.playing = true;

        // Ensure we have full track metadata, especially for items from proxied playlists (Spotify, etc.)
        if (!song._ytDlpData && !song.isRadio && song.sourceType !== 'radio') {
            try {
                logger.info('MusicManager', `Fetching full track info for "${song.title}" as it was missing.`);
                const trackInfo = await getTrackInfo(song.originalUrl);
                // Update the song object in the queue with the full data
                Object.assign(song, {
                    title: trackInfo.title,
                    originalUrl: trackInfo.originalUrl,
                    duration: trackInfo.durationRaw,
                    sourceType: trackInfo.sourceType,
                    _ytDlpData: trackInfo._ytDlpData
                });
            } catch (e) {
                logger.error('MusicManager', `Failed to fetch missing track info for "${song.title}". Skipping.`, e);
                queue.songs.shift();
                return this.playNext(guildId);
            }
        }

        try {
            let streamUrl = song.originalUrl;
            let userAgent = "Mozilla/5.0";

            // If it's a direct radio preset/stream URL, bypass yt-dlp lookup
            const isDirectRadioStream = song.sourceType === 'radio' || song.isRadio || /\.(mp3|ogg|aac|wav|flac|m4a)(\?|$)/i.test(song.originalUrl) || /streams\.ilovemusic\.de|streaming\.radio\.co|live\.musopen\.org|streams\.fluxfm\.de|radio\.synth\.fm|stream\.radioseda\.ir/i.test(song.originalUrl);

            let ffmpegArgs = [];
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
            if (queue.tempFilePath && queue.tempFilePath !== song.prefetchFilePath && queue.tempFilePath !== song._currentFilePath) {
                fsPromises.unlink(queue.tempFilePath).catch(() => {});
                queue.tempFilePath = null;
            }

            // Force download-to-file path when using a SOCKS proxy, since FFmpeg's -http_proxy
            // only supports HTTP proxies. SOCKS5 URLs are silently ignored by FFmpeg, causing
            // IP mismatch 403s on YouTube's IP-locked audio URLs.
            const proxyUrl = process.env.YOUTUBE_PROXY || '';
            const isSocksProxy = proxyUrl.toLowerCase().startsWith('socks');
            const hasDirectUrl = !isDirectRadioStream && song._ytDlpData && song._ytDlpData.url;

            if (!isDirectRadioStream && (!hasDirectUrl || isSocksProxy)) {
                if (isSocksProxy && hasDirectUrl) {
                    logger.info('MusicManager', `SOCKS proxy detected — using yt-dlp download instead of direct FFmpeg streaming for: ${song.title}`);
                    // Clear the stale IP-locked URL so fallback retries don't leak it back into the direct streaming path
                    delete song._ytDlpData.url;
                }
                // AUDIO PREFETCHING & BUFFERING OPTIMIZATION
                let lastYtDlpStderr = '';
                if (song.prefetchFilePath && !song.isPrefetching) {
                    // Use the already background-prefetched file (HDD read optimization)
                    logger.info('Prefetch', `Using prefetched audio file for: ${song.title}`);
                    tempFilePath = song.prefetchFilePath;
                    queue.tempFilePath = tempFilePath;
                    queue.ytdlpChildProcess = song.prefetchProcess || null;
                } else if (song.prefetchFilePath && song.isPrefetching && song.prefetchProcess) {
                    // Wait for the in-progress prefetch to finish instead of spawning a new duplicate process
                    logger.info('Prefetch', `Waiting for in-progress prefetch to finish for: ${song.title}`);
                    tempFilePath = song.prefetchFilePath;
                    queue.tempFilePath = tempFilePath;
                    queue.ytdlpChildProcess = song.prefetchProcess;
                } else if (song._currentFilePath) {
                    // Reuse existing file if looping
                    logger.info('Prefetch', `Reusing existing downloaded file for: ${song.title}`);
                    tempFilePath = song._currentFilePath;
                    queue.tempFilePath = tempFilePath;
                } else {
                    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
                    tempFilePath = path.join(os.tmpdir(), `discord_music_${guildId}_${Date.now()}.audio`);
                    queue.tempFilePath = tempFilePath;
                    song._currentFilePath = tempFilePath;
                    
                    const ytdlpArgs = getYtDlpArgs([
                        '-f', '251/bestaudio/best',
                        '-o', tempFilePath, 
                        '--no-part', 
                        '--buffer-size', `${hardwareOptimization.bufferSizeMB}M`, 
                        '--socket-timeout', '15', 
                        '--no-warnings', 
                        song.originalUrl
                    ]);
                    const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });
                    queue.ytdlpChildProcess = ytdlpChildProcess;

                    // Log any errors from the yt-dlp process to help debug failures
                    ytdlpChildProcess.stderr.on('data', (data) => {
                        const msg = data.toString().trim();
                        if (msg) lastYtDlpStderr = msg;
                        logger.error('yt-dlp', `[${song.title}] STDERR: ${msg}`);
                    });
                }
                
                // Wait for yt-dlp to fully finish downloading before handing off to FFmpeg.
                // Audio files are small (~3-10MB), so waiting for completion is faster than dealing
                // with partial-read errors ("Error parsing Opus packet header" from half-written files).
                await new Promise((resolve, reject) => {
                    let settled = false;
                    const settle = (fn, arg) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        fn(arg);
                    };

                    // 30s timeout — fails fast if yt-dlp hangs, allowing instant fallback
                    const timeout = setTimeout(async () => {
                        try {
                            const stats = await fsPromises.stat(tempFilePath).catch(() => null);
                            if (stats && stats.size > 1024) {
                                settle(resolve);
                                return;
                            }
                        } catch (e) { /* stat failed */ }
                        settle(reject, new Error(`yt-dlp download timed out — file was never created for: ${song.title}`));
                    }, 30000);

                    const onExit = async (code) => {
                        try {
                            const stats = await fsPromises.stat(tempFilePath).catch(() => null);
                            if (stats && stats.size > 1024) {
                                settle(resolve);
                                return;
                            }
                        } catch (e) { /* stat failed */ }
                        const detail = lastYtDlpStderr ? ` (${lastYtDlpStderr})` : '';
                        settle(reject, new Error(`yt-dlp exited with code ${code}${detail} without producing audio for: ${song.title}`));
                    };

                    // If yt-dlp already exited (prefetch completed), check immediately
                    if (queue.ytdlpChildProcess && queue.ytdlpChildProcess.exitCode !== null) {
                        onExit(queue.ytdlpChildProcess.exitCode);
                        return;
                    }

                    // Otherwise wait for the process to finish
                    if (queue.ytdlpChildProcess) {
                        queue.ytdlpChildProcess.on('close', onExit);
                    } else {
                        // No process (prefetch path) — file should already exist
                        onExit(0);
                    }
                });

                // Determine if the source is already Opus 48kHz stereo (format 251 on YouTube) — if so, we perform a zero-cost container remux (-c:a copy) at ~0% CPU.
                const sourceCodec = song._ytDlpData?.acodec || '';
                const sampleRate = song._ytDlpData?.asr || 48000;
                const channels = song._ytDlpData?.audio_channels || 2;
                const isAlreadyOpus = (sourceCodec === 'opus' || song._ytDlpData?.format_id === '251') && sampleRate === 48000 && channels === 2;

                if (!song._ytDlpData) song._ytDlpData = {};
                song._ytDlpData._transportMode = song.prefetchFilePath 
                    ? 'Prefetched Audio File' 
                    : 'yt-dlp Download-to-Disk';

                if (isAlreadyOpus) {
                    // Zero-cost codec copy: remux WebM/Opus → OggOpus container for Discord at ~0% CPU
                    logger.debug('MusicManager', `Opus passthrough (remux only) for: ${song.title}`);
                    song._ytDlpData._processingMode = 'Opus Passthrough (-c:a copy)';
                    ffmpegArgs = [
                        '-hide_banner',
                        '-err_detect', 'ignore_err'
                    ];
                    if (queue.seekOffset > 0) {
                        ffmpegArgs.push('-ss', queue.seekOffset.toString());
                    }
                    ffmpegArgs.push(
                        '-i', tempFilePath,
                        '-loglevel', 'warning',
                        '-vn',
                        '-c:a', 'copy',
                        '-f', 'opus'
                    );
                } else {
                    // Non-Opus or non-48kHz source (AAC, Vorbis, 44.1kHz, etc.) — transcode to 48kHz Stereo Opus for Discord
                    const codecLabel = sourceCodec ? sourceCodec.toUpperCase() : 'Non-Opus Audio';
                    logger.debug('MusicManager', `Transcoding ${codecLabel} (${sampleRate}Hz/${channels}ch) → 48kHz Stereo Opus for: ${song.title}`);
                    song._ytDlpData._processingMode = `Transcode ${codecLabel} → Opus 128k 48kHz`;
                    ffmpegArgs = [
                        '-hide_banner',
                        '-threads', hardwareOptimization.threads
                    ];
                    if (queue.seekOffset > 0) {
                        ffmpegArgs.push('-ss', queue.seekOffset.toString());
                    }
                    ffmpegArgs.push(
                        '-i', tempFilePath,
                        '-loglevel', 'warning',
                        '-vn',
                        '-c:a', 'libopus',
                        '-b:a', '128k',
                        '-ar', '48000',
                        '-ac', '2',
                        '-f', 'opus'
                    );
                }
            } else {
                let actualStreamUrl = streamUrl;
                if (!isDirectRadioStream && song._ytDlpData && song._ytDlpData.url) {
                    actualStreamUrl = song._ytDlpData.url;
                    logger.info('MusicManager', `Bypassing proxy download, streaming direct audio URL for: ${song.title}`);
                }

                const codecLabel = song._ytDlpData?.acodec ? song._ytDlpData.acodec.toUpperCase() : 'Stream';
                if (!song._ytDlpData) song._ytDlpData = {};
                song._ytDlpData._transportMode = 'Direct FFmpeg HTTP Stream';
                song._ytDlpData._processingMode = `Transcode ${codecLabel} → Opus 128k 48kHz`;

                // Direct streams cannot be prefetched to EOF (they are infinite or streaming)
                ffmpegArgs = [
                    '-reconnect', '1',
                    '-reconnect_streamed', '1',
                    '-reconnect_delay_max', '5',
                    '-user_agent', userAgent
                ];

                // If proxy is active, FFmpeg must route the stream through it to prevent IP mismatch 403s
                if (process.env.YOUTUBE_PROXY && actualStreamUrl.includes('googlevideo.com')) {
                    ffmpegArgs.push('-http_proxy', process.env.YOUTUBE_PROXY);
                }

                if (queue.seekOffset > 0) {
                    ffmpegArgs.push('-ss', queue.seekOffset.toString());
                }

                ffmpegArgs.push(
                    '-i', actualStreamUrl,
                    '-loglevel', 'warning',
                    '-vn',
                    '-c:a', 'libopus',
                    '-b:a', '128k',
                    '-ar', '48000',
                    '-ac', '2',
                    '-f', 'opus'
                );
            }

            queue.seekOffset = 0; // reset after applying

            const ffmpegProcess = new prism.FFmpeg({ 
                args: ffmpegArgs,
                highWaterMark: 512 * 1024 // 512 KB stream buffer to prevent stutter under CPU/network spikes
            });
            
            ffmpegProcess.process.on('error', err => logger.error('FFmpeg', 'Process Error', err));
            ffmpegProcess.process.stderr.on('data', data => logger.debug('FFmpeg', `STDERR: ${data.toString().trim()}`));
            ffmpegProcess.process.on('exit', code => logger.debug('FFmpeg', `Process exited with code ${code}`));
            
            queue.ytdlpProcess = ffmpegProcess; // Keeping same variable name for compatibility with cleanup

            const resource = createAudioResource(ffmpegProcess, {
                inputType: StreamType.OggOpus,
                inlineVolume: false
            });
            
            queue.resource = resource;

            queue.player.play(resource);
            // Clean up button controls on previous Now Playing message to keep chat tidy
            if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
                try {
                    await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, { components: [] });
                } catch (e) { /* message deleted or unreachable */ }
                queue.lastNowPlayingMessageId = null;
            }

            const settings = await loadSettings(guildId);
            if (settings.announceNowPlaying !== false) {
                const embed = new Embed()
                    .setTitle(`▶️ Now Playing`)
                    .setDescription(`**[${song.title}](${song.originalUrl})**`)
                    .setColor('#5865F2')
                    .setFooter({ text: `Duration: ${song.duration}` });
                    
                const sentMsg = await this.sendMessage(queue, { 
                    embeds: [embed],
                    components: [getPlayerControls(queue)]
                });
                if (sentMsg && sentMsg.id) {
                    queue.lastNowPlayingMessageId = sentMsg.id;
                }
            }
            this.updateStatus(song.title);
            
            // HDD Optimization: Background prefetch the next track in the queue to a separate temp file
            // This prevents playback gap and uses the 350Mbps bandwidth effectively without thrashing the HDD
            if (queue.songs.length > 1) {
                this.prefetchNextTrack(guildId, queue.songs[1]);
            }
        } catch (error) {
            logger.error('MusicManager', `Failed to play ${song.title}`, error);
            
            // Double-Layered Fallback Logic
            if (song.fallbackStage === 0) {
                song.fallbackStage = 1;
                
                if (song.sourceType === 'soundcloud') {
                    await this.sendMessage(queue, { content: `⚠️ SoundCloud stream failed, attempting YouTube fallback for **${song.title}**...` });
                    try {
                        const ytQuery = `${song.title} ${song.artist || ''}`;
                        const searchResult = await this.search(ytQuery);
                        if (searchResult && searchResult.tracks && searchResult.tracks.length > 0) {
                            const fallbackTrack = searchResult.tracks[0];
                            fallbackTrack.fallbackStage = 1;
                            queue.songs[0] = fallbackTrack;
                            return this.playNext(guildId);
                        }
                    } catch (e) {
                        logger.error('MusicManager', `SoundCloud YouTube fallback search failed for ${song.title}`, e);
                    }
                } else if (song.sourceType === 'youtube' || song.sourceType === 'other') {
                    await this.sendMessage(queue, { content: `⚠️ Stream failed, attempting SoundCloud fallback for **${song.title}**...` });
                    try {
                        // For SoundCloud fallback, we explicitly target SoundCloud via yt-dlp
                        const fallbackInfo = await getTrackInfo(`scsearch1:${song.title}`);
                        song.originalUrl = fallbackInfo.originalUrl;
                        song.sourceType = fallbackInfo.sourceType;
                        song._ytDlpData = fallbackInfo._ytDlpData;
                        return this.playNext(guildId);
                    } catch (fallbackError) {
                        logger.error('MusicManager', 'SoundCloud fallback search failed', fallbackError);
                    }
                }
            }
            
            // Advanced Stream Fallback Stage 1 -> 2
            if (song.fallbackStage === 1) {
                song.fallbackStage = 2;
                await this.sendMessage(queue, { content: `⚠️ Stream playback issue, attempting secondary direct audio format for **${song.title}**...` });
                return this.playNext(guildId);
            }
            
            await this.sendMessage(queue, { content: `❌ Playback error for **${song.title}**: ${error.message || 'Stream unplayable'}` });
            
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

    async handleQueueEnd(guildId, queue) {
        queue.playing = false;
        if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
            try {
                await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, { components: [] });
            } catch (e) {}
            queue.lastNowPlayingMessageId = null;
        }
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
            const previousSong = queue.history.pop();
            
            // Reset fallback state so the previous song gets a fresh attempt
            previousSong.fallbackStage = 0;
            
            // Insert previous song at front of queue (it will be songs[0] when playNext fires)
            queue.songs.unshift(previousSong);
            
            // Use isSeeking to bypass the Idle handler's shift/loop logic entirely.
            // Without this, the Idle handler would push songs[0] (our previousSong) back to history
            // and then shift it off, effectively replaying the current song instead.
            queue.isSeeking = true;
            queue.player.stop(); // triggers Idle → isSeeking path → playNext(songs[0] = previousSong)
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
                _ytDlpData: t._ytDlpData || null,
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
            _ytDlpData: trackInfo._ytDlpData || null,
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
                _ytDlpData: t._ytDlpData || null,
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
            _ytDlpData: trackInfo._ytDlpData || null,
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

    shuffle(guildId) {
        const queue = this.getQueue(guildId);
        if (!queue || queue.songs.length < 3) return; // Need at least 3 (playing + 2 upcoming) to shuffle
        
        const upcoming = queue.songs.slice(1);
        for (let i = upcoming.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
        }
        
        queue.songs = [queue.songs[0], ...upcoming];
        
        if (queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }
    }

    clear(guildId) {
        const queue = this.getQueue(guildId);
        if (!queue || queue.songs.length < 2) return;
        
        const removed = queue.songs.splice(1);
        for (const s of removed) {
            this._cleanupSong(s);
        }
    }

    remove(guildId, index) {
        const queue = this.getQueue(guildId);
        if (!queue || index < 1 || index >= queue.songs.length) return null;
        
        const [removed] = queue.songs.splice(index, 1);
        this._cleanupSong(removed);
        
        if (index === 1 && queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }
        
        return removed;
    }

    move(guildId, fromIndex, toIndex) {
        const queue = this.getQueue(guildId);
        if (!queue || fromIndex < 1 || fromIndex >= queue.songs.length || toIndex < 1 || toIndex >= queue.songs.length) return null;
        
        const [moved] = queue.songs.splice(fromIndex, 1);
        queue.songs.splice(toIndex, 0, moved);
        
        if ((fromIndex === 1 || toIndex === 1) && queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }
        
        return moved;
    }

    jump(guildId, index) {
        const queue = this.getQueue(guildId);
        if (!queue || index < 1 || index >= queue.songs.length) return;
        
        const skipped = queue.songs.splice(1, index - 1);
        
        if (skipped.length > 0) {
            queue.history.push(...skipped);
            while (queue.history.length > 50) {
                const oldest = queue.history.shift();
                this._cleanupSong(oldest);
            }
        }
        
        this.skip(guildId);
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
                        if (s._currentFilePath) fsPromises.unlink(s._currentFilePath).catch(() => {});
                    }
                }
                if (queue.history) {
                    for (const s of queue.history) {
                        if (s.prefetchProcess) s.prefetchProcess.kill();
                        if (s.prefetchFilePath) fsPromises.unlink(s.prefetchFilePath).catch(() => {});
                        if (s._currentFilePath) fsPromises.unlink(s._currentFilePath).catch(() => {});
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

// Startup Garbage Collection for orphaned temp files (handles SIGKILL or unexpected crashes)
setTimeout(async () => {
    try {
        const tmpdir = os.tmpdir();
        const files = await fsPromises.readdir(tmpdir);
        const now = Date.now();
        let deleted = 0;
        
        for (const file of files) {
            if (file.startsWith('discord_music_') && file.endsWith('.audio')) {
                const filePath = path.join(tmpdir, file);
                try {
                    const stats = await fsPromises.stat(filePath);
                    if (now - stats.mtimeMs > 3600000) { // Older than 1 hour
                        await fsPromises.unlink(filePath);
                        deleted++;
                    }
                } catch (e) {}
            }
        }
        if (deleted > 0) {
            logger.info('System', `Cleaned up ${deleted} orphaned audio temp files from previous sessions.`);
        }
    } catch (e) {
        logger.error('System', 'Failed to run temp file garbage collection', e);
    }
}, 5000);

