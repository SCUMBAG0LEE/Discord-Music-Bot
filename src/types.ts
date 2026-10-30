import type { Client, ParseClient, UsingClient } from 'seyfert';
import type { AudioPlayer, AudioResource, VoiceConnection } from '@discordjs/voice';
import type { ChildProcess } from 'child_process';

declare module 'seyfert' {
    interface UsingClient
        extends Pick<
            ParseClient<Client<true>>,
            | 'gateway'
            | 'me'
            | 'memberUpdateHandler'
            | 'presenceUpdateHandler'
            | 'collectors'
            | 'events'
            | 'latency'
            | 'loadEvents'
        > {}
}

export interface VoiceChannelTarget {
    id: string;
    guildId: string;
    client: UsingClient;
}

export interface YtDlpTrackData {
    url?: string;
    extractor?: string;
    webpage_url?: string;
    acodec?: string;
    format_id?: string;
    asr?: number;
    audio_channels?: number;
    abr?: number;
    tbr?: number;
    ext?: string;
    protocol?: string;
    _transportMode?: string;
    _processingMode?: string;
}

export interface Song {
    title: string;
    originalUrl: string;
    url?: string;
    duration: string;
    durationRaw?: string;
    durationInSec?: number;
    sourceType: 'youtube' | 'soundcloud' | 'radio' | 'other' | string;
    isRadio?: boolean;
    artist?: string;
    uploader?: { name?: string };
    _ytDlpData?: YtDlpTrackData | null;
    fallbackStage: number;
    requesterId?: string | null;
    requesterName?: string;
    isPrefetching?: boolean;
    prefetchFilePath?: string | null;
    prefetchProcess?: ChildProcess | null;
    _currentFilePath?: string | null;
}

export interface GuildQueue {
    guildId: string;
    voiceChannel: VoiceChannelTarget;
    voiceChannelId: string;
    textChannelId: string;
    client: UsingClient;
    connection: VoiceConnection;
    player: AudioPlayer;
    resource?: AudioResource;
    songs: Song[];
    history: Song[];
    skipVotes: Set<string>;
    playing: boolean;
    paused: boolean;
    loopMode: number; // 0 = off, 1 = song, 2 = queue
    autoplay: boolean;
    stay247: boolean;
    isSeeking: boolean;
    seekOffset: number;
    ignoreLoopOnce: boolean;
    lastIdleTime?: number;
    lastNowPlayingMessageId?: string | null;
    emptyVcTimeout?: ReturnType<typeof setTimeout> | null;
    idleTimeout?: ReturnType<typeof setTimeout> | null;
    ytdlpProcess?: any;
    ytdlpChildProcess?: ChildProcess | null;
    tempFilePath?: string | null;
    playbackStartTime: number;
    pausedAt: number | null;
    accumulatedPauseMs: number;
    initialSeekSec: number;
}

export interface ServerSettings {
    textChannelId: string | null;
    voiceChannelId: string | null;
    queueType: 'linear' | 'fair';
    autoPlaylist: { userId: string; name: string } | null;
    songInStatus: boolean;
    skipRatio: number | null;
    defaultVolume: number | null;
    djRoleId: string | null;
    stayInChannel: boolean;
    maxDuration: number | null;
    announceNowPlaying: boolean;
    [key: string]: unknown;
}

export interface PlaylistSong {
    title: string;
    name?: string;
    url: string;
    duration: string | number;
    source: string;
    sourceUrl?: string;
}

export interface Playlist {
    name: string;
    createdAt: string;
    songs: PlaylistSong[];
}

export interface PlaylistSummary {
    name: string;
    createdAt: string;
    songCount: number;
}

export interface FavoriteSong {
    url: string;
    title: string;
    duration: string;
    added_at?: number;
}

export interface SearchTrackResult {
    title: string;
    originalUrl: string;
    url: string;
    webpage_url?: string;
    duration: string;
    durationInSec: number;
    channel: string;
    sourceType: 'youtube' | 'soundcloud' | 'other';
    fallbackStage: number;
    _ytDlpData: YtDlpTrackData | null;
}
