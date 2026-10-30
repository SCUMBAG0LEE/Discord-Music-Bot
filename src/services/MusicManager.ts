import {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection,
    StreamType,
    entersState,
    type VoiceConnection,
    type DiscordGatewayAdapterCreator,
    type DiscordGatewayAdapterLibraryMethods
} from '@discordjs/voice';
import { execFile, spawn, spawnSync } from 'child_process';
import prism from 'prism-media';
import { promisify } from 'util';
import { ActionRow, Button, Embed, type UsingClient } from 'seyfert';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';

import { getYtDlpArgs } from '../utils/cookies.js';
import { loadSettings } from './serverSettings.js';
import { logger } from '../utils/logger.js';
import { getRequesterId, getRequesterName } from '../utils/permissions.js';
import { parseTimestamp } from '../utils/formatters.js';
import type {
    GuildQueue,
    SearchTrackResult,
    Song,
    VoiceChannelTarget,
    YtDlpTrackData
} from '../types.js';

export const execFileAsync = promisify(execFile);

export let ffmpegInfo = {
    type: 'unknown',
    path: 'unknown',
    version: 'unknown'
};

export const hardwareOptimization = (() => {
    const totalRamGB = os.totalmem() / 1024 / 1024 / 1024;
    const cpuCores = os.cpus().length;
    const diskType = process.env.SYSTEM_DISK_TYPE?.toLowerCase() || 'auto';

    let bufferSizeMB = 8;
    if (process.env.STREAM_BUFFER_SIZE) {
        bufferSizeMB = parseInt(process.env.STREAM_BUFFER_SIZE, 10);
    } else if (diskType === 'ssd' || diskType === 'nvme') {
        bufferSizeMB = 2;
    } else if (diskType === 'hdd') {
        bufferSizeMB = 16;
    } else {
        bufferSizeMB = totalRamGB >= 8 ? 16 : 8;
    }

    let threads = process.env.FFMPEG_THREADS?.toLowerCase() || 'auto';
    if (threads === 'auto') {
        threads = cpuCores <= 4 ? '1' : '2';
    }

    logger.info(
        'Optimization',
        `Profile applied: ${threads} FFmpeg threads | ${bufferSizeMB}MB Stream Buffer | Disk: ${diskType} | Cores: ${cpuCores} | RAM: ${totalRamGB.toFixed(1)}GB`
    );

    return {
        threads: threads.toString(),
        bufferSize: bufferSizeMB * 1024 * 1024,
        bufferSizeMB,
        diskType
    };
})();

try {
    const customFfmpeg = process.env.FFMPEG_PATH;
    let result: { error?: Error; stdout?: Buffer | string } | undefined;

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

    if (!ffmpegInfo.path || ffmpegInfo.path === 'unknown') {
        result = spawnSync('ffmpeg', ['-version'], { windowsHide: true });
        if (!result.error && result.stdout) {
            ffmpegInfo.type = 'system ffmpeg';
            ffmpegInfo.path = 'ffmpeg';
            logger.info('FFmpeg', 'System FFmpeg found! Using it directly instead of ffmpeg-static.');
        } else {
            const prismAny = prism as any;
            const staticInfo = (prismAny.default?.FFmpeg || prismAny.FFmpeg).getInfo();
            ffmpegInfo.type = 'ffmpeg-static';
            ffmpegInfo.path = staticInfo.command;
            result = { stdout: staticInfo.output };
            logger.info('FFmpeg', 'System FFmpeg not found, falling back to ffmpeg-static.');
        }
    }

    const output = result?.stdout?.toString() || '';
    const match = /version\s+([^\s]+)/.exec(output) || /version ([^\s]+) Copyright/.exec(output);
    ffmpegInfo.version = match ? match[1].replace(/-\w+$/, '') : 'unknown';
    logger.debug('FFmpeg', `Detected Version: ${ffmpegInfo.version}`);

    const prismAny = prism as any;
    const prismFfmpeg = prismAny.default?.FFmpeg || prismAny.FFmpeg;
    if (prismFfmpeg) {
        prismFfmpeg.getInfo = () => ({
            command: ffmpegInfo.path,
            output: output,
            version: ffmpegInfo.version
        });
    }
} catch (e: any) {
    logger.error('FFmpeg', 'Error configuring FFmpeg path, using fallback.', e.message || e);
    ffmpegInfo.path = ffmpegInfo.path !== 'unknown' ? ffmpegInfo.path : 'ffmpeg';
}

export const voiceAdapters = new Map<string, DiscordGatewayAdapterLibraryMethods>();

export function createSeyfertAdapter(client: UsingClient, guildId: string): DiscordGatewayAdapterCreator {
    return (methods: DiscordGatewayAdapterLibraryMethods) => {
        voiceAdapters.set(guildId, methods);
        return {
            sendPayload: (payload: any) => {
                if (payload.op === 4 && payload.d) {
                    payload.d.self_mute = payload.d.self_mute || false;
                    payload.d.self_deaf = true;
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

function isPlaylist(query: string): string | null {
    if (!query.startsWith('http://') && !query.startsWith('https://')) return null;

    if (
        query.includes('youtube.com/playlist') ||
        (query.includes('youtube.com/watch') && query.includes('list=')) ||
        query.includes('youtu.be/playlist')
    ) {
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

interface PlaylistFetchResult {
    name: string;
    tracks: Array<{
        title: string;
        originalUrl: string;
        duration: string;
        durationRaw?: string;
        durationInSec?: number;
        sourceType: string;
        _ytDlpData?: YtDlpTrackData | null;
    }>;
}

async function fetchSpotifyTracks(url: string): Promise<PlaylistFetchResult> {
    try {
        const match = url.match(/spotify\.com\/(playlist|album)\/([a-zA-Z0-9]+)/);
        if (!match) {
            throw new Error('Invalid Spotify URL. Only playlists and albums are supported.');
        }
        const type = match[1];
        const id = match[2];
        const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;

        const response = await fetch(embedUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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

        const name: string = entity.name || entity.title || 'Spotify Content';
        const rawTracks: any[] = entity.trackList || [];

        const tracks = rawTracks.map(track => {
            const title = track.title;
            const artist = track.subtitle || 'Unknown Artist';
            const durationMs = track.duration || 0;
            const durationInSec = Math.floor(durationMs / 1000);
            const durationMin = Math.floor(durationMs / 60000);
            const durationSec = String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0');
            const duration = durationMs ? `${durationMin}:${durationSec}` : 'Live/Unknown';

            return {
                title: `${title} - ${artist}`,
                originalUrl: `ytsearch1:${title} ${artist}`,
                duration,
                durationInSec,
                sourceType: 'youtube'
            };
        });

        return { name, tracks };
    } catch (e: any) {
        logger.warn('Spotify', `Scraping failed (${e.message}), falling back to yt-dlp native extraction.`);
        return await fetchYtDlpPlaylistTracks(url);
    }
}

let cachedAppleToken: string | null = null;
let appleTokenExpiry = 0;
let appleTokenPromise: Promise<string> | null = null;

async function getAppleMusicToken(): Promise<string> {
    if (cachedAppleToken && Date.now() < appleTokenExpiry) {
        return cachedAppleToken;
    }

    if (appleTokenPromise) {
        return appleTokenPromise;
    }

    appleTokenPromise = (async () => {
        const mainPageRes = await fetch('https://music.apple.com/us/browse', {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
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
        } catch {
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

async function resolveUrlRedirects(url: string): Promise<string> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) return url;
    try {
        const urlObj = new URL(url);
        const host = urlObj.hostname;
        if (
            host.includes('link.deezer.com') ||
            host.includes('deezer.page.link') ||
            host.includes('apple.co') ||
            host.includes('spotify.link')
        ) {
            const response = await fetch(url, {
                method: 'GET',
                redirect: 'follow',
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            return response.url;
        }
    } catch (e) {
        logger.error('Redirect', 'Failed to resolve URL redirects', e);
    }
    return url;
}

async function fetchDeezerTracks(url: string): Promise<PlaylistFetchResult> {
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
    const data = (await res.json()) as any;
    if (data.error) {
        throw new Error(`Deezer API error: ${data.error.message || 'Unknown error'}`);
    }

    const name: string = data.title || 'Deezer Content';
    const rawTracks: any[] = data.tracks?.data || [];

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
            durationInSec: durationSec,
            sourceType: 'youtube'
        };
    });

    return { name, tracks };
}

async function fetchAppleMusicTracks(url: string): Promise<PlaylistFetchResult> {
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
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch Apple Music data: ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    if (!data.data || data.data.length === 0) {
        throw new Error('No Apple Music playlist/album found.');
    }

    const playlist = data.data[0];
    const name: string = playlist.attributes?.name || 'Apple Music Content';

    let rawTracks: any[] = [];
    const tracksRelationship = playlist.relationships?.tracks;
    if (tracksRelationship && tracksRelationship.data) {
        rawTracks = tracksRelationship.data.slice();
        let nextUrl: string | null = tracksRelationship.next;
        while (nextUrl && rawTracks.length < 500) {
            const fullNextUrl = `https://amp-api.music.apple.com${nextUrl}`;
            const nextRes = await fetch(fullNextUrl, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Origin': 'https://music.apple.com',
                    'Referer': 'https://music.apple.com/',
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (nextRes.ok) {
                const nextData = (await nextRes.json()) as any;
                if (nextData.data && nextData.data.length > 0) {
                    rawTracks.push(...nextData.data);
                    nextUrl = nextData.next || null;
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
            durationInSec: durationSec,
            sourceType: 'youtube'
        };
    });

    return { name, tracks };
}

async function fetchYtDlpPlaylistTracks(url: string): Promise<PlaylistFetchResult> {
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
            durationInSec: durationSec,
            sourceType: data.extractor === 'soundcloud' ? 'soundcloud' : 'youtube',
            _ytDlpData: null
        };
    });

    return { name: 'Online Playlist', tracks };
}

async function getSpotifyQuery(url: string): Promise<string> {
    const userAgent =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

    // 1) Try Spotify embed __NEXT_DATA__
    const trackMatch = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?track\/([a-zA-Z0-9]+)/);
    if (trackMatch && trackMatch[1]) {
        const trackId = trackMatch[1];
        try {
            const embedRes = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
                headers: { 'User-Agent': userAgent }
            });
            if (embedRes.ok) {
                const text = await embedRes.text();
                const nextDataMatch = text.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
                if (nextDataMatch && nextDataMatch[1]) {
                    const json = JSON.parse(nextDataMatch[1]);
                    const entity = json.props?.pageProps?.state?.data?.entity;
                    if (entity) {
                        const title = entity.title || entity.name;
                        const artist =
                            entity.subtitle ||
                            (Array.isArray(entity.artists)
                                ? entity.artists.map((a: any) => a.name).filter(Boolean).join(' ')
                                : '');
                        if (title) {
                            return artist ? `${title} ${artist}` : title;
                        }
                    }
                }
            }
        } catch (e) {
            logger.debug('Spotify', 'Failed to parse Spotify embed track data', e);
        }
    }

    // 2) Fallback to Spotify oEmbed API
    try {
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': userAgent }
        });
        if (oembedRes.ok) {
            const data = (await oembedRes.json()) as any;
            if (data?.title) {
                return data.title;
            }
        }
    } catch (e) {
        logger.debug('Spotify', 'Failed to fetch Spotify oEmbed data', e);
    }

    // 3) Final fallback to <title> tag with desktop User-Agent
    try {
        const res = await fetch(url, { headers: { 'User-Agent': userAgent } });
        const text = await res.text();
        const titleMatch = text.match(/<title>(.*?) \| Spotify<\/title>/);
        if (titleMatch && titleMatch[1]) {
            return titleMatch[1].replace(' - song by ', ' ');
        }
    } catch (e) {
        logger.debug('Spotify', 'Failed to scrape Spotify title', e);
    }
    throw new Error('Could not parse Spotify URL');
}

interface ExtractedTrackInfo {
    title: string;
    originalUrl: string;
    durationInSec: number;
    durationRaw: string;
    sourceType: 'youtube' | 'soundcloud' | 'radio' | 'other';
    _ytDlpData?: YtDlpTrackData | null;
}

async function getTrackInfo(query: string, searchPrefix: string = 'ytsearch1:'): Promise<ExtractedTrackInfo> {
    const radioPresets: Record<string, string> = {
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
    const presetEntry = Object.entries(radioPresets).find(
        ([name, url]) => url === query || name === query.toLowerCase()
    );
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
    const effectivePrefix = searchPrefix || 'ytsearch1:';

    if (query.includes('spotify.com')) {
        query = await getSpotifyQuery(query);
    }

    if (query.includes('deezer.com/track/')) {
        const trackIdMatch = query.match(/deezer\.com\/(?:\w{2}\/)?track\/(\d+)/);
        if (trackIdMatch) {
            const trackId = trackIdMatch[1];
            try {
                const res = await fetch(`https://api.deezer.com/track/${trackId}`);
                if (res.ok) {
                    const data = (await res.json()) as any;
                    if (data.title && data.artist?.name) {
                        query = `${effectivePrefix}${data.title} ${data.artist.name}`;
                    }
                }
            } catch (e) {
                logger.error('Deezer', 'Failed to parse Deezer track', e);
            }
        }
    }

    if (query.includes('music.apple.com/') && (query.includes('?i=') || query.includes('/song/'))) {
        try {
            const storefrontMatch = query.match(/music\.apple\.com\/(\w{2})\//);
            const storefront = storefrontMatch ? storefrontMatch[1] : 'us';
            let trackId: string | null = null;
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
                    const data = (await res.json()) as any;
                    if (data.data && data.data[0]) {
                        const attrs = data.data[0].attributes;
                        query = `${effectivePrefix}${attrs.name} ${attrs.artistName}`;
                    }
                }
            }
        } catch (e) {
            logger.error('AppleMusic', 'Failed to parse Apple Music track', e);
        }
    }

    const isUrl = query.startsWith('http://') || query.startsWith('https://');
    const hasSearchPrefix = /^(ytsearch|scsearch)/i.test(query);
    const target = isUrl || hasSearchPrefix ? query : `${effectivePrefix}${query}`;

    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const args = getYtDlpArgs([
                '-j',
                '-f',
                '251/bestaudio/best',
                '--socket-timeout',
                '15',
                '--no-warnings',
                target
            ]);
            const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 });
            const lines = stdout.trim().split('\n').filter(Boolean);
            if (lines.length === 0) throw new Error('No data returned from yt-dlp.');
            const firstLine = lines[0];
            const data = JSON.parse(firstLine);

            return {
                title: data.title || data.fulltitle || 'Unknown Track',
                originalUrl: data.webpage_url || target,
                durationInSec: data.duration || 0,
                durationRaw: data.duration
                    ? `${Math.floor(data.duration / 60)}:${Math.floor(data.duration % 60).toString().padStart(2, '0')}`
                    : 'Live/Unknown',
                sourceType:
                    data.extractor === 'soundcloud'
                        ? 'soundcloud'
                        : data.extractor === 'youtube'
                            ? 'youtube'
                            : 'other',
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
        } catch (e: any) {
            lastError = e;
            if (attempt < maxRetries) {
                logger.warn('TrackInfo', `Attempt ${attempt} failed for ${target}, retrying... (${e.message})`);
                await new Promise(res => setTimeout(res, 2000 * attempt));
            }
        }
    }

    throw new Error(`Failed to extract track info after ${maxRetries} attempts: ${lastError?.message || lastError}`);
}

export function getPlayerControls(queue: GuildQueue): ActionRow<Button> {
    return new ActionRow<Button>().setComponents([
        new Button()
            .setCustomId('player_pause')
            .setLabel(queue.paused ? '▶️ Resume' : '⏸️ Pause')
            .setStyle(queue.paused ? 3 : 1),
        new Button()
            .setCustomId('player_skip')
            .setLabel('⏭️ Skip')
            .setStyle(2),
        new Button()
            .setCustomId('player_loop')
            .setLabel(
                queue.loopMode === 2 ? '🔁 Loop: Queue' : queue.loopMode === 1 ? '🔁 Loop: Song' : '🔁 Loop'
            )
            .setStyle(queue.loopMode !== 0 ? 3 : 2),
        new Button()
            .setCustomId('player_stop')
            .setLabel('⏹️ Stop')
            .setStyle(4)
    ]);
}

export class MusicManager {
    public queues = new Map<string, GuildQueue>();
    public client?: UsingClient;
    public searchCache = new Map<string, SearchTrackResult[]>();
    private searchCacheTimers = new Map<string, ReturnType<typeof setTimeout>>();

    public setSearchCache(key: string, tracks: SearchTrackResult[]): void {
        const existingTimer = this.searchCacheTimers.get(key);
        if (existingTimer) clearTimeout(existingTimer);

        this.searchCache.set(key, tracks);
        const timer = setTimeout(() => {
            this.searchCache.delete(key);
            this.searchCacheTimers.delete(key);
        }, 5 * 60 * 1000);
        if (timer.unref) timer.unref();
        this.searchCacheTimers.set(key, timer);
    }

    public getSearchCache(key: string): SearchTrackResult[] | undefined {
        return this.searchCache.get(key);
    }

    public async search(
        query: string,
        platform: 'youtube' | 'soundcloud' = 'youtube',
        limit: number = 10
    ): Promise<{ tracks: SearchTrackResult[] }> {
        const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
        const searchPrefix = platform === 'soundcloud' ? `scsearch${limit}:` : `ytsearch${limit}:`;
        const args = getYtDlpArgs([
            '-j',
            '--flat-playlist',
            '--socket-timeout',
            '15',
            '--no-warnings',
            `${searchPrefix}${query}`
        ]);

        const { stdout } = await execFileAsync(ytdlpPath, args, { maxBuffer: 1024 * 1024 * 10 });
        const lines = stdout.trim().split('\n').filter(Boolean);

        const tracks: SearchTrackResult[] = [];
        for (const line of lines) {
            try {
                const res = JSON.parse(line);
                const durationSec = typeof res.duration === 'number' ? Math.floor(res.duration) : 0;
                const duration = durationSec
                    ? `${Math.floor(durationSec / 60)}:${(durationSec % 60).toString().padStart(2, '0')}`
                    : 'Unknown';
                const channel = res.channel || res.uploader || 'Unknown';
                const url =
                    res.webpage_url ||
                    res.url ||
                    (res.id && platform === 'youtube' ? `https://www.youtube.com/watch?v=${res.id}` : '');
                if (!url) continue;

                tracks.push({
                    title: res.title || res.fulltitle || 'Unknown Track',
                    originalUrl: url,
                    url,
                    webpage_url: res.webpage_url || url,
                    duration,
                    durationInSec: durationSec,
                    channel,
                    sourceType:
                        platform === 'soundcloud' || String(res.extractor || '').includes('soundcloud')
                            ? 'soundcloud'
                            : 'youtube',
                    fallbackStage: 0,
                    _ytDlpData: null
                });
            } catch {
                // Skip malformed JSON line
            }
        }

        return { tracks: tracks.slice(0, limit) };
    }

    public _cleanupSong(song: Song | undefined | null): void {
        if (!song) return;
        if (song.prefetchProcess) {
            try {
                song.prefetchProcess.kill();
            } catch { }
            song.prefetchProcess = null;
            logger.debug('Prefetch', `Killed prefetch process for: ${song.title}`);
        }
        if (song.prefetchFilePath) {
            fsPromises
                .unlink(song.prefetchFilePath)
                .catch(err =>
                    logger.warn('Prefetch', `Failed to delete prefetch file ${song.prefetchFilePath}: ${err.message}`)
                );
            song.prefetchFilePath = null;
        }
        if (song._currentFilePath) {
            fsPromises.unlink(song._currentFilePath).catch(() => { });
            song._currentFilePath = null;
        }
    }

    public clearIdleTimeout(queue: GuildQueue | undefined | null): void {
        if (queue && queue.idleTimeout) {
            clearTimeout(queue.idleTimeout);
            queue.idleTimeout = null;
        }
    }

    public getPlaybackElapsedSeconds(queue: GuildQueue | undefined | null): number {
        if (!queue || !queue.playing || !queue.playbackStartTime) return 0;
        const now = queue.paused && queue.pausedAt ? queue.pausedAt : Date.now();
        const elapsedMs = Math.max(0, now - queue.playbackStartTime - (queue.accumulatedPauseMs || 0));
        return Math.floor(elapsedMs / 1000) + (queue.initialSeekSec || 0);
    }

    public enqueueSong(queue: GuildQueue, song: Song, queueType: 'linear' | 'fair' = 'linear'): void {
        if (queueType !== 'fair' || queue.songs.length <= 2 || !song.requesterId) {
            queue.songs.push(song);
            return;
        }

        // Count how many upcoming songs (index >= 1) belong to this requester
        let myUpcomingCount = 0;
        for (let i = 1; i < queue.songs.length; i++) {
            if (queue.songs[i].requesterId === song.requesterId) {
                myUpcomingCount++;
            }
        }
        const targetRound = myUpcomingCount + 1;

        // Find the first position in upcoming songs where a user's occurrence count exceeds targetRound
        const userCounts = new Map<string, number>();
        let insertIdx = queue.songs.length;
        for (let i = 1; i < queue.songs.length; i++) {
            const reqId = queue.songs[i].requesterId || `__anon_${i}`;
            const count = (userCounts.get(reqId) || 0) + 1;
            userCounts.set(reqId, count);
            if (count > targetRound) {
                insertIdx = i;
                break;
            }
        }

        queue.songs.splice(insertIdx, 0, song);
        if (insertIdx === 1 && queue.playing) {
            this.prefetchNextTrack(queue.guildId, queue.songs[1]);
        }
    }

    public async sendMessage(queue: GuildQueue, options: any): Promise<any> {
        try {
            if (queue.client && queue.textChannelId) {
                return await queue.client.messages.write(queue.textChannelId, options);
            }
        } catch (e) {
            logger.error('MusicManager', 'Failed to send message', e);
        }
        return null;
    }

    private restoreDefaultPresence(): void {
        if (!this.client) return;
        let activityType = 0;
        const typeStr = process.env.ACTIVITY_TYPE?.toUpperCase();
        if (typeStr === 'PLAYING') activityType = 0;
        if (typeStr === 'STREAMING') activityType = 1;
        if (typeStr === 'LISTENING') activityType = 2;
        if (typeStr === 'WATCHING') activityType = 3;
        if (typeStr === 'CUSTOM') activityType = 4;
        if (typeStr === 'COMPETING') activityType = 5;

        this.client.gateway.setPresence({
            since: null,
            afk: false,
            status: (process.env.BOT_STATUS as any) || 'online',
            activities: [
                {
                    name: process.env.ACTIVITY_NAME || 'music',
                    type: activityType,
                    url: process.env.STREAMING_URL || undefined
                }
            ]
        });
    }

    public async updateStatus(
        songTitle?: string | null,
        sourceUrl?: string | null,
        sourceType?: string | null
    ): Promise<void> {
        if (!this.client) return;

        try {
            const playingQueues: GuildQueue[] = [];
            for (const q of this.queues.values()) {
                if (q.playing && q.songs.length > 0) {
                    playingQueues.push(q);
                }
            }

            if (playingQueues.length === 0) {
                this.restoreDefaultPresence();
                return;
            }

            const globalSongInStatus = process.env.SONG_IN_STATUS === 'true';

            if (playingQueues.length >= 2) {
                let anyEnabled = globalSongInStatus;
                if (!anyEnabled) {
                    for (const q of playingQueues) {
                        const s = await loadSettings(q.guildId);
                        if (s.songInStatus) {
                            anyEnabled = true;
                            break;
                        }
                    }
                }
                if (!anyEnabled) {
                    this.restoreDefaultPresence();
                    return;
                }

                this.client.gateway.setPresence({
                    since: null,
                    afk: false,
                    status: (process.env.BOT_STATUS as any) || 'online',
                    activities: [
                        {
                            name: 'music in multiple servers',
                            type: 2 // Listening
                        }
                    ]
                });
                return;
            }

            // Exactly 1 queue is playing
            const activeQueue = playingQueues[0];
            const settings = await loadSettings(activeQueue.guildId);
            if (!globalSongInStatus && !settings.songInStatus) {
                this.restoreDefaultPresence();
                return;
            }

            const activeSong = activeQueue.songs[0];
            const title = songTitle || activeSong?.title || 'music';
            const url = sourceUrl || activeSong?.originalUrl || '';
            const type = sourceType || activeSong?.sourceType || 'other';

            const isStreamableUrl =
                /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|twitch\.tv)\//i.test(url) ||
                (type === 'youtube' && url.startsWith('http'));

            if (isStreamableUrl) {
                this.client.gateway.setPresence({
                    since: null,
                    afk: false,
                    status: (process.env.BOT_STATUS as any) || 'online',
                    activities: [
                        {
                            name: title,
                            type: 1, // Streaming (purple badge)
                            url
                        }
                    ]
                });
            } else {
                this.client.gateway.setPresence({
                    since: null,
                    afk: false,
                    status: (process.env.BOT_STATUS as any) || 'online',
                    activities: [
                        {
                            name: title,
                            type: 0 // Playing
                        }
                    ]
                });
            }
        } catch (err) {
            logger.error('MusicManager', 'Failed to update bot status', err);
        }
    }

    public getQueue(guildId: string): GuildQueue | undefined {
        return this.queues.get(guildId);
    }

    public async joinChannel(channel: VoiceChannelTarget): Promise<VoiceConnection> {
        const connection = joinVoiceChannel({
            channelId: channel.id,
            guildId: channel.guildId,
            adapterCreator: createSeyfertAdapter(channel.client, channel.guildId)
        });

        return connection;
    }

    public pause(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (queue && queue.player && !queue.paused) {
            queue.player.pause();
            queue.paused = true;
            queue.pausedAt = Date.now();
        }
    }

    public resume(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (queue && queue.player && queue.paused) {
            queue.player.unpause();
            queue.paused = false;
            if (queue.pausedAt) {
                queue.accumulatedPauseMs += Date.now() - queue.pausedAt;
                queue.pausedAt = null;
            }
        }
    }

    public async _ensureQueue(channel: VoiceChannelTarget, textChannel: any): Promise<GuildQueue> {
        const guildId = channel.guildId;
        let queue = this.getQueue(guildId);

        if (queue) {
            if (textChannel?.channelId) {
                queue.textChannelId = textChannel.channelId;
            }
            return queue;
        }

        const settings = await loadSettings(guildId);
        const player = createAudioPlayer();
        const connection = await this.joinChannel(channel);

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
        } catch (error) {
            logger.error(
                'VoiceConnection',
                `Connection failed to enter Ready state within 30s for guild ${guildId}`,
                error
            );
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
            skipVotes: new Set<string>(),
            playing: false,
            paused: false,
            loopMode: 0,
            autoplay: false,
            stay247: Boolean(settings.stayInChannel || process.env.STAY_IN_CHANNEL === 'true'),
            isSeeking: false,
            seekOffset: 0,
            ignoreLoopOnce: false,
            idleTimeout: null,
            emptyVcTimeout: null,
            playbackStartTime: 0,
            pausedAt: null,
            accumulatedPauseMs: 0,
            initialSeekSec: 0
        };
        this.queues.set(guildId, queue);

        connection.on('stateChange', (oldState, newState) => {
            logger.debug('VoiceConnection', `${oldState.status} -> ${newState.status}`);
        });
        connection.on('error', err => logger.error('VoiceConnection', 'Connection error', err));

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
                ]);
                logger.info('VoiceConnection', `Reconnecting voice for guild ${guildId}...`);
            } catch {
                logger.warn('VoiceConnection', `Failed to reconnect voice for guild ${guildId}, destroying connection.`);
                this.leave(guildId);
            }
        });

        player.on('stateChange', (oldState, newState) => {
            logger.debug('AudioPlayer', `${oldState.status} -> ${newState.status}`);
        });

        connection.subscribe(player);

        player.on(AudioPlayerStatus.Idle, async () => {
            const currentQueue = this.getQueue(guildId);
            if (!currentQueue) return;

            const now = Date.now();
            if (currentQueue.lastIdleTime && now - currentQueue.lastIdleTime < 500) {
                logger.debug(
                    'AudioPlayer',
                    `Ignoring duplicate Idle event (${now - currentQueue.lastIdleTime}ms since last)`
                );
                return;
            }
            currentQueue.lastIdleTime = now;

            if (currentQueue.ytdlpProcess) {
                if (typeof currentQueue.ytdlpProcess.destroy === 'function') currentQueue.ytdlpProcess.destroy();
                if (
                    currentQueue.ytdlpProcess.process &&
                    typeof currentQueue.ytdlpProcess.process.kill === 'function'
                ) {
                    currentQueue.ytdlpProcess.process.kill();
                }
                currentQueue.ytdlpProcess = null;
            }
            if (currentQueue.isSeeking) {
                currentQueue.isSeeking = false;
                this.playNext(guildId);
            } else {
                const currentSong = currentQueue.songs[0];
                if (currentSong) {
                    const isRepeatingSong = currentQueue.loopMode === 1 && !currentQueue.ignoreLoopOnce;
                    if (!isRepeatingSong) {
                        this._cleanupSong(currentSong);
                    }

                    currentQueue.history.push(currentSong);
                    while (currentQueue.history.length > 50) {
                        const oldest = currentQueue.history.shift();
                        this._cleanupSong(oldest);
                    }

                    if (isRepeatingSong) {
                        // Song loop, do not shift
                    } else if (currentQueue.loopMode === 2) {
                        if (currentQueue.ignoreLoopOnce) currentQueue.ignoreLoopOnce = false;
                        currentQueue.songs.shift();
                        currentQueue.songs.push(currentSong);
                    } else {
                        if (currentQueue.ignoreLoopOnce) currentQueue.ignoreLoopOnce = false;
                        currentQueue.songs.shift();
                    }
                }

                if (currentQueue.songs.length > 0) {
                    this.playNext(guildId);
                } else if (currentQueue.autoplay && currentSong) {
                    try {
                        const relatedTitle = currentSong.title
                            .replace(/[^\w\s]/gi, '')
                            .split(' ')
                            .slice(0, 4)
                            .join(' ');
                        const info = await getTrackInfo(`${relatedTitle} mix`, 'ytsearch1:');

                        if (info && info.title) {
                            currentQueue.songs.push({
                                title: info.title,
                                originalUrl: info.originalUrl,
                                duration: info.durationRaw,
                                durationInSec: info.durationInSec,
                                sourceType: info.sourceType || 'youtube',
                                _ytDlpData: info._ytDlpData || null,
                                fallbackStage: 0,
                                requesterId: null,
                                requesterName: 'Autoplay'
                            });
                            this.playNext(guildId);
                        } else {
                            this.handleQueueEnd(guildId, currentQueue);
                        }
                    } catch {
                        this.handleQueueEnd(guildId, currentQueue);
                    }
                } else {
                    this.handleQueueEnd(guildId, currentQueue);
                }
            }
        });

        player.on('error', error => {
            logger.error('AudioPlayer', `Audio error: ${error.message}`);
            const currentQueue = this.getQueue(guildId);
            if (!currentQueue) return;
            const failedSong = currentQueue.songs.shift();
            this._cleanupSong(failedSong);
            this.playNext(guildId);
        });

        return queue;
    }

    public async playSongs(channel: VoiceChannelTarget, songs: any[], textChannel: any): Promise<any> {
        const guildId = channel.guildId;
        const queue = await this._ensureQueue(channel, textChannel);
        this.clearIdleTimeout(queue);

        const settings = await loadSettings(guildId);
        const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE || '0', 10) || 0;
        const maxDuration = settings.maxDuration ?? (parseInt(process.env.MAX_DURATION || '0', 10) || 0);

        if (maxQueue > 0 && queue.songs.length >= maxQueue) {
            return textChannel?.editOrReply({
                content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`,
                flags: 64
            });
        }

        const requesterId = getRequesterId(textChannel);
        const requesterName = getRequesterName(textChannel);

        let addedCount = 0;
        for (const s of songs) {
            if (maxQueue > 0 && queue.songs.length >= maxQueue) {
                break;
            }
            const durationSec =
                typeof s.durationInSec === 'number'
                    ? s.durationInSec
                    : typeof s.duration === 'number'
                        ? s.duration
                        : parseTimestamp(String(s.duration || '')) ?? 0;

            if (maxDuration > 0 && durationSec > maxDuration) {
                continue;
            }

            const newSong: Song = {
                title: s.title,
                originalUrl: s.originalUrl,
                duration: String(s.duration),
                durationInSec: durationSec,
                sourceType: s.sourceType || 'youtube',
                _ytDlpData: s._ytDlpData || null,
                fallbackStage: 0,
                requesterId,
                requesterName
            };
            this.enqueueSong(queue, newSong, settings.queueType);
            addedCount++;
        }

        if (addedCount === 0) {
            return textChannel?.editOrReply({
                content: maxDuration > 0
                    ? `❌ No songs were added (all tracks exceeded maximum allowed duration of \`${maxDuration}s\`).`
                    : '❌ No songs could be added to the queue.',
                flags: 64
            });
        }

        await textChannel
            ?.editOrReply({ content: `✅ Added **${addedCount}** songs to the queue.` })
            .catch(() => this.sendMessage(queue, { content: `✅ Added **${addedCount}** songs to the queue.` }));

        if (!queue.playing) {
            await this.playNext(guildId);
        }
    }

    public async play(
        channel: VoiceChannelTarget,
        query: string,
        textChannel: any,
        searchPrefix: string = 'ytsearch1:'
    ): Promise<any> {
        const guildId = channel.guildId;
        const existingQueue = this.getQueue(guildId);
        if (existingQueue) {
            this.clearIdleTimeout(existingQueue);
        }

        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }

        const playlistType = isPlaylist(resolvedQuery);

        if (playlistType) {
            try {
                let playlistResult: PlaylistFetchResult;
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

                await textChannel
                    ?.editOrReply({
                        content: `🎵 Loading **${playlistResult.tracks.length}** songs from playlist **${playlistResult.name}**...`
                    })
                    .catch(() => { });

                await this.playSongs(channel, playlistResult.tracks, textChannel);
            } catch (e: any) {
                logger.error('MusicManager', 'Error loading playlist', e);
                return textChannel?.editOrReply({ content: `❌ Error loading playlist: ${e.message}` });
            }
            return;
        }

        const settings = await loadSettings(guildId);
        let trackInfo: ExtractedTrackInfo;
        try {
            trackInfo = await getTrackInfo(resolvedQuery, searchPrefix);

            const maxDuration = settings.maxDuration ?? (parseInt(process.env.MAX_DURATION || '0', 10) || 0);
            if (maxDuration > 0 && trackInfo.durationInSec > maxDuration) {
                return textChannel?.editOrReply({
                    content: `❌ Song is too long! Maximum allowed duration is \`${maxDuration}s\`.`,
                    flags: 64
                });
            }
        } catch (error) {
            logger.error('MusicManager', 'Error fetching track', error);
            return textChannel?.editOrReply({ content: '❌ Could not find or validate that track.', flags: 64 });
        }

        const song: Song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            durationInSec: trackInfo.durationInSec,
            sourceType: trackInfo.sourceType,
            _ytDlpData: trackInfo._ytDlpData || null,
            fallbackStage: 0,
            requesterId: getRequesterId(textChannel),
            requesterName: getRequesterName(textChannel)
        };

        const queue = await this._ensureQueue(channel, textChannel);
        this.clearIdleTimeout(queue);

        const maxQueue = parseInt(process.env.MAX_QUEUE_SIZE || '0', 10) || 0;
        if (maxQueue > 0 && queue.songs.length >= maxQueue) {
            return textChannel?.editOrReply({
                content: `❌ Queue is full! Maximum allowed songs is \`${maxQueue}\`.`,
                flags: 64
            });
        }

        this.enqueueSong(queue, song, settings.queueType);
        await textChannel
            ?.editOrReply({ content: `🎵 Added to queue: **${song.title}**` })
            .catch(() => this.sendMessage(queue, { content: `🎵 Added to queue: **${song.title}**` }));

        if (!queue.playing) {
            await this.playNext(guildId);
        }
    }

    public seek(guildId: string, seconds: number): void {
        const queue = this.getQueue(guildId);
        if (queue && queue.playing && queue.songs.length > 0) {
            queue.seekOffset = Math.max(0, seconds);
            queue.isSeeking = true;
            queue.player.stop();
        }
    }

    public async prefetchNextTrack(guildId: string, nextSong: Song | undefined): Promise<void> {
        if (
            !nextSong ||
            nextSong.sourceType === 'radio' ||
            nextSong.isRadio ||
            nextSong.prefetchFilePath ||
            nextSong.isPrefetching
        ) {
            return;
        }

        nextSong.isPrefetching = true;
        const tempFilePath = path.join(os.tmpdir(), `discord_music_prefetch_${guildId}_${Date.now()}.audio`);
        nextSong.prefetchFilePath = tempFilePath;

        try {
            const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
            const ytdlpArgs = getYtDlpArgs([
                '-f',
                '251/bestaudio/best',
                '-o',
                tempFilePath,
                '--no-part',
                '--print-json',
                '--buffer-size',
                `${hardwareOptimization.bufferSizeMB}M`,
                '--socket-timeout',
                '15',
                '--no-warnings',
                nextSong.originalUrl
            ]);
            const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });

            nextSong.prefetchProcess = ytdlpChildProcess;

            let stdoutChunks: Buffer[] | null = [];
            ytdlpChildProcess.stdout.on('data', (data: Buffer) => {
                if (stdoutChunks) stdoutChunks.push(data);
            });

            ytdlpChildProcess.stderr.on('data', (data: Buffer) => {
                logger.debug('Prefetch', `[${nextSong.title}] STDERR: ${data.toString().trim()}`);
            });

            ytdlpChildProcess.on('close', async code => {
                nextSong.isPrefetching = false;

                if (code === 0) {
                    try {
                        const stats = await fsPromises.stat(tempFilePath).catch(() => null);
                        if (stats && stats.size > 1024) {
                            try {
                                if (stdoutChunks) {
                                    const jsonStr = Buffer.concat(stdoutChunks).toString();
                                    const metadata = JSON.parse(jsonStr);
                                    if (!nextSong._ytDlpData) {
                                        nextSong._ytDlpData = metadata;
                                    } else {
                                        nextSong._ytDlpData.acodec = metadata.acodec || nextSong._ytDlpData.acodec;
                                        nextSong._ytDlpData.format_id =
                                            metadata.format_id || nextSong._ytDlpData.format_id;
                                        nextSong._ytDlpData.asr = metadata.asr || nextSong._ytDlpData.asr;
                                        nextSong._ytDlpData.audio_channels =
                                            metadata.audio_channels || nextSong._ytDlpData.audio_channels;
                                        nextSong._ytDlpData.abr =
                                            metadata.abr || metadata.tbr || nextSong._ytDlpData.abr;
                                        nextSong._ytDlpData.ext = metadata.ext || nextSong._ytDlpData.ext;
                                        nextSong._ytDlpData.protocol =
                                            metadata.protocol || nextSong._ytDlpData.protocol;
                                    }
                                }
                            } catch {
                                logger.debug('Prefetch', `Could not parse yt-dlp metadata for ${nextSong.title}`);
                            }

                            const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
                            logger.info('Prefetch', `Ready: ${nextSong.title} (${sizeMB} MB)`);
                        } else {
                            nextSong.prefetchProcess = null;
                            fsPromises.unlink(tempFilePath).catch(() => { });
                            logger.debug('Prefetch', `File missing/empty after successful exit for: ${nextSong.title}`);
                        }
                    } catch (e: any) {
                        nextSong.prefetchProcess = null;
                        logger.debug('Prefetch', `Post-download check failed for ${nextSong.title}: ${e.message}`);
                    }
                } else {
                    nextSong.prefetchProcess = null;
                    nextSong.prefetchFilePath = null;
                    fsPromises.unlink(tempFilePath).catch(() => { });
                    logger.debug('Prefetch', `Failed (exit code ${code}): ${nextSong.title}`);
                }
                stdoutChunks = null;
            });

            ytdlpChildProcess.on('error', err => {
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

    public async playNext(guildId: string): Promise<void> {
        const queue = this.getQueue(guildId);
        if (!queue) return;

        this.clearIdleTimeout(queue);

        const song = queue.songs[0];
        queue.skipVotes.clear();

        if (!song) {
            await this.handleQueueEnd(guildId, queue);
            return;
        }

        queue.playing = true;

        if (!song._ytDlpData && !song.isRadio && song.sourceType !== 'radio') {
            try {
                logger.info('MusicManager', `Fetching full track info for "${song.title}" as it was missing.`);
                const trackInfo = await getTrackInfo(song.originalUrl);
                Object.assign(song, {
                    title: trackInfo.title,
                    originalUrl: trackInfo.originalUrl,
                    duration: trackInfo.durationRaw,
                    durationInSec: trackInfo.durationInSec,
                    sourceType: trackInfo.sourceType,
                    _ytDlpData: trackInfo._ytDlpData
                });
            } catch (e) {
                logger.error('MusicManager', `Failed to fetch missing track info for "${song.title}". Skipping.`, e);
                const failed = queue.songs.shift();
                this._cleanupSong(failed);
                return this.playNext(guildId);
            }
        }

        try {
            const streamUrl = song.originalUrl;
            const userAgent = 'Mozilla/5.0';

            const isDirectRadioStream =
                song.sourceType === 'radio' ||
                song.isRadio ||
                /\.(mp3|ogg|aac|wav|flac|m4a)(\?|$)/i.test(song.originalUrl) ||
                /streams\.ilovemusic\.de|streaming\.radio\.co|live\.musopen\.org|streams\.fluxfm\.de|radio\.synth\.fm|stream\.radioseda\.ir/i.test(
                    song.originalUrl
                );

            let ffmpegArgs: string[] = [];
            let tempFilePath: string | null = null;

            if (queue.ytdlpProcess) {
                if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') {
                    queue.ytdlpProcess.process.kill();
                }
                queue.ytdlpProcess = null;
            }
            if (queue.ytdlpChildProcess && queue.ytdlpChildProcess !== song.prefetchProcess) {
                queue.ytdlpChildProcess.kill();
                queue.ytdlpChildProcess = null;
            }
            if (
                queue.tempFilePath &&
                queue.tempFilePath !== song.prefetchFilePath &&
                queue.tempFilePath !== song._currentFilePath
            ) {
                fsPromises.unlink(queue.tempFilePath).catch(() => { });
                queue.tempFilePath = null;
            }

            const proxyUrl = process.env.YOUTUBE_PROXY || '';
            const isSocksProxy = proxyUrl.toLowerCase().startsWith('socks');
            const hasDirectUrl = Boolean(!isDirectRadioStream && song._ytDlpData && song._ytDlpData.url);
            const hasLocalOrPrefetch = Boolean(
                song.prefetchFilePath ||
                song.isPrefetching ||
                (song._currentFilePath && fs.existsSync(song._currentFilePath))
            );

            if (!isDirectRadioStream && (hasLocalOrPrefetch || !hasDirectUrl || isSocksProxy)) {
                if (isSocksProxy && hasDirectUrl && song._ytDlpData) {
                    logger.info(
                        'MusicManager',
                        `SOCKS proxy detected — using yt-dlp download instead of direct FFmpeg streaming for: ${song.title}`
                    );
                    delete song._ytDlpData.url;
                }

                let lastYtDlpStderr = '';
                if (song.prefetchFilePath && !song.isPrefetching) {
                    logger.info('Prefetch', `Using prefetched audio file for: ${song.title}`);
                    tempFilePath = song.prefetchFilePath;
                    queue.tempFilePath = tempFilePath;
                    queue.ytdlpChildProcess = song.prefetchProcess || null;
                } else if (song.prefetchFilePath && song.isPrefetching && song.prefetchProcess) {
                    logger.info('Prefetch', `Waiting for in-progress prefetch to finish for: ${song.title}`);
                    tempFilePath = song.prefetchFilePath;
                    queue.tempFilePath = tempFilePath;
                    queue.ytdlpChildProcess = song.prefetchProcess;
                } else if (song._currentFilePath && fs.existsSync(song._currentFilePath)) {
                    logger.info('Prefetch', `Reusing existing downloaded file for: ${song.title}`);
                    tempFilePath = song._currentFilePath;
                    queue.tempFilePath = tempFilePath;
                } else {
                    const ytdlpPath = process.env.YTDLP_PATH || 'yt-dlp';
                    tempFilePath = path.join(os.tmpdir(), `discord_music_${guildId}_${Date.now()}.audio`);
                    queue.tempFilePath = tempFilePath;
                    song._currentFilePath = tempFilePath;

                    const ytdlpArgs = getYtDlpArgs([
                        '-f',
                        '251/bestaudio/best',
                        '-o',
                        tempFilePath,
                        '--no-part',
                        '--buffer-size',
                        `${hardwareOptimization.bufferSizeMB}M`,
                        '--socket-timeout',
                        '15',
                        '--no-warnings',
                        song.originalUrl
                    ]);
                    const ytdlpChildProcess = spawn(ytdlpPath, ytdlpArgs, { windowsHide: true });
                    queue.ytdlpChildProcess = ytdlpChildProcess;

                    ytdlpChildProcess.stderr.on('data', (data: Buffer) => {
                        const msg = data.toString().trim();
                        if (msg) lastYtDlpStderr = msg;
                        logger.error('yt-dlp', `[${song.title}] STDERR: ${msg}`);
                    });
                }

                const targetFile = tempFilePath!;
                await new Promise<void>((resolve, reject) => {
                    let settled = false;
                    const settle = (fn: (arg?: any) => void, arg?: any) => {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeout);
                        fn(arg);
                    };

                    const timeout = setTimeout(async () => {
                        try {
                            const stats = await fsPromises.stat(targetFile).catch(() => null);
                            if (stats && stats.size > 1024) {
                                settle(resolve);
                                return;
                            }
                        } catch { }
                        settle(
                            reject,
                            new Error(`yt-dlp download timed out — file was never created for: ${song.title}`)
                        );
                    }, 30000);

                    const onExit = async (code: number | null) => {
                        try {
                            const stats = await fsPromises.stat(targetFile).catch(() => null);
                            if (stats && stats.size > 1024) {
                                settle(resolve);
                                return;
                            }
                        } catch { }
                        const detail = lastYtDlpStderr ? ` (${lastYtDlpStderr})` : '';
                        settle(
                            reject,
                            new Error(
                                `yt-dlp exited with code ${code}${detail} without producing audio for: ${song.title}`
                            )
                        );
                    };

                    if (queue.ytdlpChildProcess && queue.ytdlpChildProcess.exitCode !== null) {
                        onExit(queue.ytdlpChildProcess.exitCode);
                        return;
                    }

                    if (queue.ytdlpChildProcess) {
                        queue.ytdlpChildProcess.on('close', onExit);
                    } else {
                        onExit(0);
                    }
                });

                const sourceCodec = song._ytDlpData?.acodec || '';
                const sampleRate = song._ytDlpData?.asr || 48000;
                const channels = song._ytDlpData?.audio_channels || 2;
                const isAlreadyOpus =
                    (sourceCodec === 'opus' || song._ytDlpData?.format_id === '251') &&
                    sampleRate === 48000 &&
                    channels === 2;

                const wasPrefetched = Boolean(song.prefetchFilePath);
                song._currentFilePath = targetFile;
                song.prefetchFilePath = null;
                song.prefetchProcess = null;

                if (!song._ytDlpData) song._ytDlpData = {};
                song._ytDlpData._transportMode = wasPrefetched
                    ? 'Prefetched Audio File'
                    : 'yt-dlp Download-to-Disk';

                if (isAlreadyOpus) {
                    logger.debug('MusicManager', `Opus passthrough (remux only) for: ${song.title}`);
                    song._ytDlpData._processingMode = 'Opus Passthrough (-c:a copy)';
                    ffmpegArgs = ['-hide_banner', '-err_detect', 'ignore_err'];
                    if (queue.seekOffset > 0) {
                        ffmpegArgs.push('-ss', queue.seekOffset.toString());
                    }
                    ffmpegArgs.push('-i', targetFile, '-loglevel', 'warning', '-vn', '-c:a', 'copy', '-f', 'opus');
                } else {
                    const codecLabel = sourceCodec ? sourceCodec.toUpperCase() : 'Non-Opus Audio';
                    logger.debug(
                        'MusicManager',
                        `Transcoding ${codecLabel} (${sampleRate}Hz/${channels}ch) → 48kHz Stereo Opus for: ${song.title}`
                    );
                    song._ytDlpData._processingMode = `Transcode ${codecLabel} → Opus 128k 48kHz`;
                    ffmpegArgs = ['-hide_banner', '-threads', hardwareOptimization.threads];
                    if (queue.seekOffset > 0) {
                        ffmpegArgs.push('-ss', queue.seekOffset.toString());
                    }
                    ffmpegArgs.push(
                        '-i',
                        targetFile,
                        '-loglevel',
                        'warning',
                        '-vn',
                        '-c:a',
                        'libopus',
                        '-b:a',
                        '128k',
                        '-ar',
                        '48000',
                        '-ac',
                        '2',
                        '-f',
                        'opus'
                    );
                }
            } else {
                let actualStreamUrl = streamUrl;
                if (!isDirectRadioStream && song._ytDlpData && song._ytDlpData.url) {
                    actualStreamUrl = song._ytDlpData.url;
                    logger.info(
                        'MusicManager',
                        `Bypassing proxy download, streaming direct audio URL for: ${song.title}`
                    );
                }

                const codecLabel = song._ytDlpData?.acodec ? song._ytDlpData.acodec.toUpperCase() : 'Stream';
                if (!song._ytDlpData) song._ytDlpData = {};
                song._ytDlpData._transportMode = 'Direct FFmpeg HTTP Stream';
                song._ytDlpData._processingMode = `Transcode ${codecLabel} → Opus 128k 48kHz`;

                ffmpegArgs = [
                    '-reconnect',
                    '1',
                    '-reconnect_streamed',
                    '1',
                    '-reconnect_delay_max',
                    '5',
                    '-user_agent',
                    userAgent
                ];

                if (process.env.YOUTUBE_PROXY && actualStreamUrl.includes('googlevideo.com')) {
                    ffmpegArgs.push('-http_proxy', process.env.YOUTUBE_PROXY);
                }

                if (queue.seekOffset > 0) {
                    ffmpegArgs.push('-ss', queue.seekOffset.toString());
                }

                ffmpegArgs.push(
                    '-i',
                    actualStreamUrl,
                    '-loglevel',
                    'warning',
                    '-vn',
                    '-c:a',
                    'libopus',
                    '-b:a',
                    '128k',
                    '-ar',
                    '48000',
                    '-ac',
                    '2',
                    '-f',
                    'opus'
                );
            }

            const appliedSeek = queue.seekOffset || 0;
            queue.seekOffset = 0;

            const prismAny = prism as any;
            const FFmpegClass = prismAny.default?.FFmpeg || prismAny.FFmpeg;
            const ffmpegProcess = new FFmpegClass({
                args: ffmpegArgs,
                highWaterMark: 512 * 1024
            });

            ffmpegProcess.process?.on('error', (err: Error) => logger.error('FFmpeg', 'Process Error', err));
            ffmpegProcess.process?.stderr?.on('data', (data: Buffer) =>
                logger.debug('FFmpeg', `STDERR: ${data.toString().trim()}`)
            );
            ffmpegProcess.process?.on('exit', (code: number | null) =>
                logger.debug('FFmpeg', `Process exited with code ${code}`)
            );

            queue.ytdlpProcess = ffmpegProcess;

            const resource = createAudioResource(ffmpegProcess, {
                inputType: StreamType.OggOpus,
                inlineVolume: false
            });

            queue.resource = resource;
            queue.initialSeekSec = appliedSeek;
            queue.playbackStartTime = Date.now();
            queue.pausedAt = null;
            queue.accumulatedPauseMs = 0;
            queue.paused = false;

            queue.player.play(resource);

            if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
                try {
                    await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, {
                        components: []
                    });
                } catch { }
                queue.lastNowPlayingMessageId = null;
            }

            const settings = await loadSettings(guildId);
            if (settings.announceNowPlaying !== false) {
                const embed = new Embed()
                    .setTitle('▶️ Now Playing')
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
            await this.updateStatus(song.title, song.originalUrl, song.sourceType);

            if (queue.songs.length > 1) {
                this.prefetchNextTrack(guildId, queue.songs[1]);
            }
        } catch (error: any) {
            logger.error('MusicManager', `Failed to play ${song.title}`, error);

            if (song.fallbackStage === 0) {
                song.fallbackStage = 1;

                if (song.sourceType === 'soundcloud') {
                    await this.sendMessage(queue, {
                        content: `⚠️ SoundCloud stream failed, attempting YouTube fallback for **${song.title}**...`
                    });
                    try {
                        const ytQuery = `${song.title} ${song.artist || ''}`.trim();
                        const searchResult = await this.search(ytQuery, 'youtube', 5);
                        if (searchResult && searchResult.tracks && searchResult.tracks.length > 0) {
                            const fallbackTrack = searchResult.tracks[0];
                            queue.songs[0] = {
                                ...song,
                                title: fallbackTrack.title,
                                originalUrl: fallbackTrack.originalUrl,
                                duration: fallbackTrack.duration,
                                durationInSec: fallbackTrack.durationInSec,
                                sourceType: fallbackTrack.sourceType,
                                _ytDlpData: null,
                                fallbackStage: 1
                            };
                            return this.playNext(guildId);
                        }
                    } catch (e) {
                        logger.error('MusicManager', `SoundCloud YouTube fallback search failed for ${song.title}`, e);
                    }
                } else if (song.sourceType === 'youtube' || song.sourceType === 'other') {
                    await this.sendMessage(queue, {
                        content: `⚠️ Stream failed, attempting SoundCloud fallback for **${song.title}**...`
                    });
                    try {
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

            if (song.fallbackStage === 1) {
                song.fallbackStage = 2;
                await this.sendMessage(queue, {
                    content: `⚠️ Stream playback issue, attempting secondary direct audio format for **${song.title}**...`
                });
                return this.playNext(guildId);
            }

            await this.sendMessage(queue, {
                content: `❌ Playback error for **${song.title}**: ${error.message || 'Stream unplayable'}`
            });

            const failed = queue.songs.shift();
            this._cleanupSong(failed);

            if (song) {
                queue.history.push(song);
                if (queue.history.length > 50) queue.history.shift();
            }

            if (queue.songs.length > 0) {
                this.playNext(guildId);
            } else {
                await this.handleQueueEnd(guildId, queue);
            }
        }
    }

    public async handleQueueEnd(guildId: string, queue: GuildQueue): Promise<void> {
        queue.playing = false;
        queue.playbackStartTime = 0;
        queue.pausedAt = null;
        queue.accumulatedPauseMs = 0;
        queue.initialSeekSec = 0;

        if (queue.lastNowPlayingMessageId && queue.textChannelId && queue.client) {
            try {
                await queue.client.messages.edit(queue.textChannelId, queue.lastNowPlayingMessageId, {
                    components: []
                });
            } catch { }
            queue.lastNowPlayingMessageId = null;
        }
        await this.updateStatus(null);

        const settings = await loadSettings(guildId);
        const stayInChannel = Boolean(queue.stay247 || settings.stayInChannel);
        if (!stayInChannel) {
            const timeoutSecs = parseInt(process.env.IDLE_TIMEOUT || '60', 10) || 60;
            if (timeoutSecs > 0) {
                this.clearIdleTimeout(queue);
                queue.idleTimeout = setTimeout(async () => {
                    const currentQueue = this.getQueue(guildId);
                    if (currentQueue && !currentQueue.playing) {
                        const latestSettings = await loadSettings(guildId);
                        if (currentQueue.stay247 || latestSettings.stayInChannel) return;
                        await this.sendMessage(currentQueue, {
                            content: '👋 Left the voice channel due to inactivity.'
                        });
                        this.leave(guildId);
                    }
                }, timeoutSecs * 1000);
            }
        }
    }

    public skip(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (queue && queue.player) {
            queue.player.stop();
        }
    }

    public previous(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (queue && queue.history.length > 0) {
            const previousSong = queue.history.pop()!;
            previousSong.fallbackStage = 0;
            queue.songs.unshift(previousSong);
            queue.isSeeking = true;
            queue.player.stop();
        }
    }

    public async forcePlay(
        channel: VoiceChannelTarget,
        query: string,
        textChannel: any,
        searchPrefix: string = 'ytsearch1:'
    ): Promise<any> {
        const guildId = channel.guildId;
        const queue = this.getQueue(guildId);

        if (!queue) {
            return this.play(channel, query, textChannel, searchPrefix);
        }

        this.clearIdleTimeout(queue);

        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }

        const settings = await loadSettings(guildId);
        const maxDuration = settings.maxDuration ?? (parseInt(process.env.MAX_DURATION || '0', 10) || 0);
        const requesterId = getRequesterId(textChannel);
        const requesterName = getRequesterName(textChannel);

        const playlistType = isPlaylist(resolvedQuery);
        if (playlistType) {
            let playlistResult: PlaylistFetchResult;
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

            const songs: Song[] = playlistResult.tracks
                .filter(t => !(maxDuration > 0 && t.durationInSec && t.durationInSec > maxDuration))
                .map(t => ({
                    title: t.title,
                    originalUrl: t.originalUrl,
                    duration: t.durationRaw || t.duration,
                    durationInSec: t.durationInSec,
                    sourceType: t.sourceType || 'youtube',
                    _ytDlpData: t._ytDlpData || null,
                    fallbackStage: 0,
                    requesterId,
                    requesterName
                }));

            if (songs.length === 0) {
                return textChannel?.editOrReply({
                    content: `❌ All tracks in the playlist exceeded maximum allowed duration of \`${maxDuration}s\`.`,
                    flags: 64
                });
            }

            queue.songs.splice(1, 0, ...songs);
            queue.ignoreLoopOnce = true;
            this.skip(guildId);

            try {
                await textChannel?.editOrReply({
                    content: `⚡ Force playing playlist: **${playlistResult.name}** (${songs.length} songs)`
                });
            } catch {
                await this.sendMessage(queue, {
                    content: `⚡ Force playing playlist: **${playlistResult.name}** (${songs.length} songs)`
                });
            }
            return;
        }

        const trackInfo = await getTrackInfo(resolvedQuery, searchPrefix);
        if (maxDuration > 0 && trackInfo.durationInSec > maxDuration) {
            return textChannel?.editOrReply({
                content: `❌ Song is too long! Maximum allowed duration is \`${maxDuration}s\`.`,
                flags: 64
            });
        }

        const song: Song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            durationInSec: trackInfo.durationInSec,
            sourceType: trackInfo.sourceType,
            _ytDlpData: trackInfo._ytDlpData || null,
            fallbackStage: 0,
            requesterId,
            requesterName
        };

        queue.songs.splice(1, 0, song);
        queue.ignoreLoopOnce = true;
        this.skip(guildId);

        try {
            await textChannel?.editOrReply({ content: `⚡ Force playing: **${song.title}**` });
        } catch {
            await this.sendMessage(queue, { content: `⚡ Force playing: **${song.title}**` });
        }
    }

    public async playNextSong(
        channel: VoiceChannelTarget,
        query: string,
        textChannel: any,
        searchPrefix: string = 'ytsearch1:'
    ): Promise<any> {
        const guildId = channel.guildId;
        const queue = this.getQueue(guildId);

        if (!queue) {
            return this.play(channel, query, textChannel, searchPrefix);
        }

        this.clearIdleTimeout(queue);

        let resolvedQuery = query;
        if (query.startsWith('http://') || query.startsWith('https://')) {
            resolvedQuery = await resolveUrlRedirects(query);
        }

        const settings = await loadSettings(guildId);
        const maxDuration = settings.maxDuration ?? (parseInt(process.env.MAX_DURATION || '0', 10) || 0);
        const requesterId = getRequesterId(textChannel);
        const requesterName = getRequesterName(textChannel);

        const playlistType = isPlaylist(resolvedQuery);
        if (playlistType) {
            let playlistResult: PlaylistFetchResult;
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

            const songs: Song[] = playlistResult.tracks
                .filter(t => !(maxDuration > 0 && t.durationInSec && t.durationInSec > maxDuration))
                .map(t => ({
                    title: t.title,
                    originalUrl: t.originalUrl,
                    duration: t.durationRaw || t.duration,
                    durationInSec: t.durationInSec,
                    sourceType: t.sourceType || 'youtube',
                    _ytDlpData: t._ytDlpData || null,
                    fallbackStage: 0,
                    requesterId,
                    requesterName
                }));

            if (songs.length === 0) {
                return textChannel?.editOrReply({
                    content: `❌ All tracks in the playlist exceeded maximum allowed duration of \`${maxDuration}s\`.`,
                    flags: 64
                });
            }

            queue.songs.splice(1, 0, ...songs);
            if (queue.playing && queue.songs.length > 1) {
                this.prefetchNextTrack(guildId, queue.songs[1]);
            }
            try {
                await textChannel?.editOrReply({
                    content: `⏭️ Added playlist to play next: **${playlistResult.name}** (${songs.length} songs)`
                });
            } catch {
                await this.sendMessage(queue, {
                    content: `⏭️ Added playlist to play next: **${playlistResult.name}** (${songs.length} songs)`
                });
            }
            return;
        }

        const trackInfo = await getTrackInfo(resolvedQuery, searchPrefix);
        if (maxDuration > 0 && trackInfo.durationInSec > maxDuration) {
            return textChannel?.editOrReply({
                content: `❌ Song is too long! Maximum allowed duration is \`${maxDuration}s\`.`,
                flags: 64
            });
        }

        const song: Song = {
            title: trackInfo.title,
            originalUrl: trackInfo.originalUrl,
            duration: trackInfo.durationRaw,
            durationInSec: trackInfo.durationInSec,
            sourceType: trackInfo.sourceType,
            _ytDlpData: trackInfo._ytDlpData || null,
            fallbackStage: 0,
            requesterId,
            requesterName
        };

        queue.songs.splice(1, 0, song);
        if (queue.playing && queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }
        try {
            await textChannel?.editOrReply({ content: `⏭️ Added to play next: **${song.title}**` });
        } catch {
            await this.sendMessage(queue, { content: `⏭️ Added to play next: **${song.title}**` });
        }
    }

    public shuffle(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (!queue || queue.songs.length < 3) return;

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

    public clear(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (!queue || queue.songs.length < 2) return;

        const removed = queue.songs.splice(1);
        for (const s of removed) {
            this._cleanupSong(s);
        }
    }

    public remove(guildId: string, index: number): Song | null {
        const queue = this.getQueue(guildId);
        if (!queue || index < 1 || index >= queue.songs.length) return null;

        const [removed] = queue.songs.splice(index, 1);
        this._cleanupSong(removed);

        if (index === 1 && queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }

        return removed;
    }

    public move(guildId: string, fromIndex: number, toIndex: number): Song | null {
        const queue = this.getQueue(guildId);
        if (
            !queue ||
            fromIndex < 1 ||
            fromIndex >= queue.songs.length ||
            toIndex < 1 ||
            toIndex >= queue.songs.length
        ) {
            return null;
        }

        const [moved] = queue.songs.splice(fromIndex, 1);
        queue.songs.splice(toIndex, 0, moved);

        if ((fromIndex === 1 || toIndex === 1) && queue.songs.length > 1) {
            this.prefetchNextTrack(guildId, queue.songs[1]);
        }

        return moved;
    }

    public jump(guildId: string, index: number): void {
        const queue = this.getQueue(guildId);
        if (!queue || index < 1 || index >= queue.songs.length) return;

        const skipped = queue.songs.splice(1, index - 1);

        if (skipped.length > 0) {
            for (const s of skipped) {
                this._cleanupSong(s);
            }
            queue.history.push(...skipped);
            while (queue.history.length > 50) {
                const oldest = queue.history.shift();
                this._cleanupSong(oldest);
            }
        }

        this.skip(guildId);
    }

    public leave(guildId: string): void {
        const queue = this.getQueue(guildId);
        if (queue) {
            try {
                this.clearIdleTimeout(queue);
                if (queue.emptyVcTimeout) {
                    clearTimeout(queue.emptyVcTimeout);
                    queue.emptyVcTimeout = null;
                }
                if (queue.player) queue.player.stop();
                if (queue.connection) queue.connection.destroy();
                if (queue.ytdlpProcess) {
                    if (typeof queue.ytdlpProcess.destroy === 'function') queue.ytdlpProcess.destroy();
                    if (queue.ytdlpProcess.process && typeof queue.ytdlpProcess.process.kill === 'function') {
                        queue.ytdlpProcess.process.kill();
                    }
                }
                if (queue.ytdlpChildProcess) queue.ytdlpChildProcess.kill();
                if (queue.tempFilePath) {
                    fsPromises.unlink(queue.tempFilePath).catch(() => { });
                }
                if (queue.songs) {
                    for (const s of queue.songs) {
                        this._cleanupSong(s);
                    }
                }
                if (queue.history) {
                    for (const s of queue.history) {
                        this._cleanupSong(s);
                    }
                }
            } catch { }
            this.queues.delete(guildId);
            this.updateStatus(null);
        } else {
            const connection = getVoiceConnection(guildId);
            if (connection) connection.destroy();
        }
    }
}

export const musicManager = new MusicManager();

const cleanup = () => {
    logger.info('System', 'Cleaning up active music engine allocations...');
    for (const [guildId, queue] of musicManager.queues.entries()) {
        try {
            musicManager.clearIdleTimeout(queue);
            if (queue.emptyVcTimeout) clearTimeout(queue.emptyVcTimeout);
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
                    if (s._currentFilePath && fs.existsSync(s._currentFilePath)) {
                        fs.unlinkSync(s._currentFilePath);
                    }
                }
            }
        } catch { }
    }
    process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

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
                    if (now - stats.mtimeMs > 3600000) {
                        await fsPromises.unlink(filePath);
                        deleted++;
                    }
                } catch { }
            }
        }
        if (deleted > 0) {
            logger.info('System', `Cleaned up ${deleted} orphaned audio temp files from previous sessions.`);
        }
    } catch (e) {
        logger.error('System', 'Failed to run temp file garbage collection', e);
    }
}, 5000);

