/**
 * DisTube Service
 * Manages the DisTube instance and event handling
 */

const { DisTube, Events } = require('distube');
const { YtDlpPlugin } = require('../plugins/YtDlpPlugin');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { logger } = require('../utils/logger');
const { loadSettings } = require('./serverSettings');
const { getPlaylist } = require('./playlists');

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
          headers: [
            'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin: https://www.youtube.com',
            'Referer: https://www.youtube.com/'
          ].join('\r\n')
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
      
      // Clear vote skip votes when a new song starts
      if (queue.votes) queue.votes.clear();
      if (queue.skipVotes) queue.skipVotes.clear();
      
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
        const { ActivityType } = require('discord.js');
        client.user.setPresence({
          activities: [{ name: song.name.slice(0, 128), type: ActivityType.Listening }],
          status: client.config?.status || 'online'
        });
      }
    })
    .on(Events.ADD_SONG, (queue, song) => {
      logger.queue(queue.id, 'addSong', { title: song.name });
      
      // Check max duration from server settings
      const settings = loadSettings(queue.id);
      if (settings.maxDuration && song.duration > settings.maxDuration) {
        // Remove the song from queue
        const index = queue.songs.indexOf(song);
        if (index > 0) {
          queue.songs.splice(index, 1);
        }
        const maxMins = Math.floor(settings.maxDuration / 60);
        queue.textChannel?.send(`❌ Rejected **${song.name}** - exceeds max duration (${maxMins} min limit)`);
        return;
      }
      
      queue.textChannel?.send(`✅ Added to queue: **${song.name}** - \`${song.formattedDuration}\``);
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
        client.startAloneTimeout(queue);
      }
    })
    .on(Events.FINISH, async queue => {
      logger.player(queue.id, 'Queue finished');
      
      // Check for auto-playlist
      const settings = loadSettings(queue.id);
      if (settings.autoPlaylist?.name && settings.autoPlaylist?.userId) {
        const playlist = getPlaylist(settings.autoPlaylist.userId, settings.autoPlaylist.name);
        if (playlist?.songs?.length > 0) {
          logger.info('DisTube', `Auto-playing playlist: ${settings.autoPlaylist.name}`);
          queue.textChannel?.send(`📻 Auto-playing playlist: **${settings.autoPlaylist.name}**`);
          
          // Play the first song and add the rest
          try {
            const songs = playlist.songs;
            for (const song of songs) {
              await distube.play(queue.voiceChannel, song.url, {
                textChannel: queue.textChannel,
                member: queue.clientMember
              });
            }
            return; // Don't send "queue finished" message
          } catch (err) {
            logger.error('DisTube', 'Auto-playlist failed', err);
            queue.textChannel?.send('❌ Failed to start auto-playlist: ' + err.message);
          }
        }
      }
      
      queue.textChannel?.send('✅ Queue finished! Use `/play` to add more songs.');
      
      // Reset bot status to default
      if (client.config?.songInStatus || queue.songInStatus) {
        const { ActivityType } = require('discord.js');
        client.user.setPresence({
          activities: [{ name: client.config?.activityName || 'music | /help', type: client.config?.activityType || ActivityType.Listening }],
          status: client.config?.status || 'online'
        });
      }
      
      // Start idle timeout if configured
      if (client.startIdleTimeout) {
        client.startIdleTimeout(queue);
      }
    })
    .on(Events.DISCONNECT, queue => {
      logger.voice(queue.id, 'Disconnected from voice channel');
    })
    .on(Events.INIT_QUEUE, queue => {
      logger.queue(queue.id, 'Queue initialized');
      // Set default queue properties
      queue.volume = client.config?.defaultVolume || 100;
      queue.autoplay = false;
      queue.votes = new Set(); // For vote skip
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
