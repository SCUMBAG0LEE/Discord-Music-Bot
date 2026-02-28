/**
 * DisTube Service
 * Manages the DisTube instance and event handling
 */

const { DisTube, Events } = require('distube');
const { ActivityType } = require('discord.js');
const { YtDlpPlugin } = require('../plugins/YtDlpPlugin');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { logger } = require('../utils/logger');
const { loadSettings } = require('./serverSettings');
const { getPlaylist } = require('./playlists');

/**
 * Build presence options for a song in status.
 * YouTube/Twitch URLs get Streaming type (purple badge + clickable link),
 * everything else gets Playing type.
 */
function songPresenceOpts(url) {
  if (url && /(?:youtube\.com|youtu\.be|twitch\.tv)\b/i.test(url)) {
    return { type: ActivityType.Streaming, url };
  }
  return { type: ActivityType.Playing };
}

// FFmpeg filter presets for audio effects
const filterPresets = {
  bassboost: 'bass=g=10',
  '3d': 'apulsator=hz=0.125',
  vaporwave: 'asetrate=44100*0.8,aresample=44100,atempo=1.1',
  nightcore: 'asetrate=44100*1.25,aresample=44100',

  phaser: 'aphaser=in_gain=0.4',
  tremolo: 'tremolo',
  vibrato: 'vibrato=f=6.5',
  reverse: 'areverse',
  treble: 'treble=g=5',
  normalizer: 'dynaudnorm=g=101',
  surrounding: 'surround',
  pulsator: 'apulsator=hz=1',
  subboost: 'asubboost',
  karaoke: 'stereotools=mlev=0.03',
  flanger: 'flanger',
  gate: 'agate',
  haas: 'haas',
  mcompand: 'mcompand',
  earwax: 'earwax'
};

/** @type {DisTube|null} */
let distube = null;

/**
 * Initialize DisTube with the Discord client
 * @param {import('discord.js').Client} client
 * @returns {DisTube}
 */
function initialize(client) {
  const plugins = [];

  // yt-dlp plugin - handles all YouTube playback (most reliable)
  // Store reference for search functionality
  const ytdlpPlugin = new YtDlpPlugin();
  plugins.push(ytdlpPlugin);
  logger.info('DisTube', 'Using yt-dlp for YouTube playback');

  // Add Spotify plugin - will use yt-dlp for search since it's first
  if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
    plugins.push(new SpotifyPlugin({
      api: {
        clientId: process.env.SPOTIFY_CLIENT_ID,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
        topTracksCountry: process.env.SPOTIFY_MARKET || 'US'
      }
    }));
    logger.info('DisTube', 'Spotify plugin enabled');
  } else {
    logger.warn('DisTube', 'Spotify credentials not configured - Spotify support disabled');
  }

  // SoundCloud plugin - only for direct SoundCloud URLs, not for search
  plugins.push(new SoundCloudPlugin());

  // Create DisTube instance with filter presets
  distube = new DisTube(client, {
    plugins,
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    // Custom filters for /filter command
    ffmpeg: {
      args: {
        global: {},
        input: {
          reconnect: 1,
          reconnect_streamed: 1,
          reconnect_delay_max: 5,
          headers: 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        output: {}
      },
      filters: filterPresets
    }
  });

  // Store yt-dlp plugin reference on distube instance for /search command
  distube.ytdlpPlugin = ytdlpPlugin;

  distube.setMaxListeners(20);
  setupEvents(distube, client);
  
  logger.success('DisTube', 'Initialized successfully');
  return distube;
}

/**
 * Set up DisTube event handlers
 * @param {DisTube} distube
 * @param {import('discord.js').Client} client
 */
function setupEvents(distube, client) {
  distube
    .on(Events.PLAY_SONG, async (queue, song) => {
      logger.player(queue.id, 'playSong', { title: song.name, duration: song.duration });
      
      // Clear any pending idle/alone timeout when music starts
      if (client.clearGuildTimeout) {
        client.clearGuildTimeout(queue.id);
      }
      
      // Clear vote skip votes when a new song starts
      if (queue.votes) queue.votes.clear();
      if (queue.skipVotes) queue.skipVotes.clear();
      
      // A song played successfully — allow auto-playlist to trigger again later
      queue._autoPlaylistAttempted = false;
      
      const nowPlayingMsg = `🎵 Now playing: **${song.name}** - \`${song.formattedDuration}\``;
      
      // Try to edit the original "Processing" message if it exists
      const replyMessage = song.metadata?.replyMessage;
      if (replyMessage) {
        try {
          await replyMessage.edit(nowPlayingMsg);
          delete song.metadata.replyMessage;
          return;
        } catch (e) {
          logger.debug('DisTube', 'Could not edit reply message: ' + e.message);
        }
      }
      
      // Fallback: send a new message (for skip, autoplay, etc.)
      // Unless suppressNowPlaying is set or announceNowPlaying is disabled
      const settings = loadSettings(queue.id);
      if (!queue.suppressNowPlaying && settings.announceNowPlaying !== false) {
        queue.textChannel?.send(nowPlayingMsg);
      }
      queue.suppressNowPlaying = false;
      
      // Update bot status with current song if enabled
      if (client.config?.songInStatus || queue.songInStatus) {
        const activeQueues = distube.queues.size;
        
        if (activeQueues > 1) {
          // Multiple servers — "Listening to music in multiple servers"
          client.user.setPresence(client.buildPresence('music in multiple servers', { type: ActivityType.Listening }));
        } else {
          // Single server — Streaming for YouTube/Twitch (purple badge), Playing for others
          client.user.setPresence(client.buildPresence(song.name.slice(0, 128), songPresenceOpts(song.url)));
        }
      }
    })
    .on(Events.ADD_SONG, async (queue, song) => {
      logger.queue(queue.id, 'addSong', { title: song.name });
      
      // Check max queue size
      const maxQueueSize = client.config?.maxQueueSize || 0;
      if (maxQueueSize > 0 && queue.songs.length > maxQueueSize) {
        const index = queue.songs.indexOf(song);
        if (index > 0) {
          queue.songs.splice(index, 1);
        }
        const replyMessage = song.metadata?.replyMessage;
        if (replyMessage) {
          try {
            await replyMessage.edit(`❌ Queue is full (max ${maxQueueSize} songs)`);
            delete song.metadata.replyMessage;
            return;
          } catch (e) { /* ignore */ }
        }
        queue.textChannel?.send(`❌ Queue is full (max ${maxQueueSize} songs)`);
        return;
      }
      
      // Check max duration from server settings (with global fallback)
      const settings = loadSettings(queue.id);
      const maxDuration = settings.maxDuration || client.config?.maxDuration || 0;
      if (maxDuration > 0 && song.duration > maxDuration) {
        // Remove the song from queue
        const index = queue.songs.indexOf(song);
        if (index > 0) {
          queue.songs.splice(index, 1);
        }
        const maxMins = Math.floor(maxDuration / 60);
        
        // Try to edit the Processing message, otherwise send new message
        const replyMessage = song.metadata?.replyMessage;
        if (replyMessage) {
          try {
            await replyMessage.edit(`❌ Rejected **${song.name}** - exceeds max duration (${maxMins} min limit)`);
            delete song.metadata.replyMessage;
            return;
          } catch (e) { /* ignore */ }
        }
        queue.textChannel?.send(`❌ Rejected **${song.name}** - exceeds max duration (${maxMins} min limit)`);
        return;
      }
      
      const addedMsg = `✅ Added to queue: **${song.name}** - \`${song.formattedDuration}\``;
      
      // Try to edit the original "Processing" message if it exists
      const replyMessage = song.metadata?.replyMessage;
      if (replyMessage) {
        try {
          await replyMessage.edit(addedMsg);
          delete song.metadata.replyMessage;
          return;
        } catch (e) {
          logger.debug('DisTube', 'Could not edit reply message: ' + e.message);
        }
      }
      
      // Fallback: send a new message
      queue.textChannel?.send(addedMsg);
    })
    .on(Events.ADD_LIST, (queue, playlist) => {
      logger.queue(queue.id, 'addPlaylist', { name: playlist.name, count: playlist.songs.length });
      queue.textChannel?.send(`✅ Added **${playlist.name}** playlist (${playlist.songs.length} songs) to the queue`);
    })
    .on(Events.ERROR, (error, queue, song) => {
      logger.error('DisTube', `Error in queue ${queue?.id}`, error);
      queue?.textChannel?.send(`❌ Error: ${error.message.slice(0, 200)}`);
    })
    .on(Events.EMPTY, queue => {
      logger.voice(queue.id, 'Voice channel empty');
      // Start alone timeout if configured
      if (client.startAloneTimeout) {
        client.startAloneTimeout(queue.id, {
          textChannel: queue.textChannel,
          stayInChannel: queue.stayInChannel
        });
      }
    })
    .on(Events.FINISH, async queue => {
      logger.player(queue.id, 'Queue finished');
      
      // Check for auto-playlist (with loop guard)
      const settings = loadSettings(queue.id);
      if (settings.autoPlaylist?.name && settings.autoPlaylist?.userId && !queue._autoPlaylistAttempted) {
        const playlist = getPlaylist(settings.autoPlaylist.userId, settings.autoPlaylist.name);
        if (playlist?.songs?.length > 0) {
          logger.info('DisTube', `Auto-playing playlist: ${settings.autoPlaylist.name}`);
          queue.textChannel?.send(`📻 Auto-playing playlist: **${settings.autoPlaylist.name}**`);
          
          let loaded = 0;
          for (const song of playlist.songs) {
            try {
              await distube.play(queue.voiceChannel, song.url, {
                textChannel: queue.textChannel,
                member: queue.clientMember
              });
              loaded++;
            } catch (err) {
              // Skip individual failures
            }
          }

          if (loaded > 0) {
            // Mark the NEW queue so it won't re-trigger auto-playlist if all songs error
            const newQueue = distube.getQueue(queue.id);
            if (newQueue) newQueue._autoPlaylistAttempted = true;
            return; // Don't send "queue finished" message
          }

          queue.textChannel?.send('❌ Auto-playlist failed: no songs could be loaded.');
        }
      }
      
      queue.textChannel?.send('✅ Queue finished! Use `/play` to add more songs.');
      
      // Reset bot status - but check if other queues are still active
      if (client.config?.songInStatus || queue.songInStatus) {
        // NOTE: During FINISH the finishing queue is still in the map,
        // so we subtract 1 just like we do in DISCONNECT.
        const remainingQueues = distube.queues.size - 1;
        
        if (remainingQueues > 1) {
          client.user.setPresence(client.buildPresence('music in multiple servers', { type: ActivityType.Listening }));
        } else if (remainingQueues === 1) {
          // Find the other (still-playing) queue
          for (const q of distube.queues.values()) {
            if (q.id !== queue.id && q.songs?.[0]) {
              const s = q.songs[0];
              client.user.setPresence(client.buildPresence(s.name.slice(0, 128), songPresenceOpts(s.url)));
              break;
            }
          }
        } else {
          // No queues left - reset to default status
          client.user.setPresence(client.buildPresence(client.config?.activityName || 'music | /help'));
        }
      }
      
      // Start idle timeout if configured
      if (client.startIdleTimeout) {
        client.startIdleTimeout(queue.id, {
          textChannel: queue.textChannel,
          stayInChannel: queue.stayInChannel
        });
      }
    })
    .on(Events.DISCONNECT, queue => {
      logger.voice(queue.id, 'Disconnected from voice channel');
      
      // Clear any pending timeouts for this guild
      if (client.clearGuildTimeout) {
        client.clearGuildTimeout(queue.id);
      }
      
      // Update status if needed (similar to FINISH)
      if (client.config?.songInStatus || queue.songInStatus) {
        const remainingQueues = distube.queues.size - 1; // -1 because this queue is being removed
        
        if (remainingQueues > 1) {
          client.user.setPresence(client.buildPresence('music in multiple servers', { type: ActivityType.Listening }));
        } else if (remainingQueues === 1) {
          // Find the remaining queue
          for (const q of distube.queues.values()) {
            if (q.id !== queue.id && q.songs?.[0]) {
              const s = q.songs[0];
              client.user.setPresence(client.buildPresence(s.name.slice(0, 128), songPresenceOpts(s.url)));
              break;
            }
          }
        } else {
          // No queues left
          client.user.setPresence(client.buildPresence(client.config?.activityName || 'music | /help'));
        }
      }
    })
    .on(Events.INIT_QUEUE, queue => {
      logger.queue(queue.id, 'Queue initialized');
      // Set default queue properties (per-server overrides global)
      const settings = loadSettings(queue.id);
      queue.volume = settings.defaultVolume ?? client.config?.defaultVolume ?? 50;
      queue.autoplay = false;
      queue.votes = new Set(); // For vote skip
      queue.skipVotes = new Set(); // For vote skip tracking
      
      // Load server-specific settings
      queue.songInStatus = settings.songInStatus || false;
      queue.stayInChannel = settings.stayInChannel || false;
    })
    .on(Events.SEARCH_NO_RESULT, (message, query) => {
      logger.warn('DisTube', `No results for: ${query}`);
    })
    .on(Events.NO_RELATED, (queue, error) => {
      logger.warn('DisTube', `No related songs found for autoplay in ${queue.id}`);
      queue.textChannel?.send('⚠️ Autoplay: No related songs found.');
    })
    .on(Events.FFMPEG_DEBUG, (debug) => {
      logger.debug('FFmpeg', debug);
    });
}

/**
 * Get the DisTube instance
 * @returns {DisTube|null}
 */
function getInstance() {
  return distube;
}

/**
 * Check if a URL is a direct stream URL (radio/audio)
 * @param {string} url
 * @returns {boolean}
 */
function isStreamUrl(url) {
  const streamPatterns = [
    /\.(mp3|ogg|aac|wav|flac|m4a)(\?|$)/i,
    /\/stream\/?(\?|$)/i,
    /streaming\./i,
    /icecast/i,
    /shoutcast/i,
    /radio/i
  ];
  return streamPatterns.some(p => p.test(url));
}

/**
 * Radio preset stations
 */
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

/**
 * Get a radio preset URL
 * @param {string} preset
 * @returns {string|null}
 */
function getRadioPreset(preset) {
  return radioPresets[preset.toLowerCase()] || null;
}

/**
 * Get list of available radio presets
 * @returns {string[]}
 */
function getRadioPresetNames() {
  return Object.keys(radioPresets);
}

module.exports = {
  initialize,
  getInstance,
  isStreamUrl,
  getRadioPreset,
  getRadioPresetNames
};
