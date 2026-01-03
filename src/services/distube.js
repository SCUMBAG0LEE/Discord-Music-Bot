const { DisTube, Events } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const { SpotifyPlugin } = require('@distube/spotify');
const { SoundCloudPlugin } = require('@distube/soundcloud');
const { logger } = require('../utils/logger');
const path = require('path');

/** @type {DisTube|null} */
let distube = null;

/**
 * Initialize DisTube with the Discord client
 * @param {import('discord.js').Client} client
 * @returns {DisTube}
 */
function initialize(client) {
  // Initialize plugins
  // Using yt-dlp for YouTube as it's more reliable against YouTube's anti-bot measures
  const plugins = [
    new SoundCloudPlugin()
  ];

  // Add Spotify plugin if credentials are configured
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

  // YtDlpPlugin should be LAST in the plugins array (as per documentation)
  // It supports 900+ sites including YouTube
  plugins.push(new YtDlpPlugin({
    update: true  // Auto-update yt-dlp binary on startup
  }));
  logger.info('DisTube', 'Using yt-dlp for YouTube (more reliable than ytdl-core)');

  // Create DisTube instance
  distube = new DisTube(client, {
    plugins,
    emitNewSongOnly: true,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false
  });

  // Increase max listeners to avoid warning
  distube.setMaxListeners(20);

  // Set up event handlers
  setupEvents(distube);

  logger.success('DisTube', 'Initialized successfully');
  return distube;
}

/**
 * Set up DisTube event handlers
 * @param {DisTube} distube
 */
function setupEvents(distube) {
  distube
    .on(Events.PLAY_SONG, (queue, song) => {
      logger.player(queue.id, 'playSong', { title: song.name, duration: song.duration });
      // Clear vote skip votes when a new song starts
      if (queue.votes) queue.votes.clear();
      queue.textChannel?.send(`🎵 Now playing: **${song.name}** - \`${song.formattedDuration}\``);
    })
    .on(Events.ADD_SONG, (queue, song) => {
      logger.queue(queue.id, 'addSong', { title: song.name });
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
      // DisTube handles auto-leave via leaveOnEmpty option
    })
    .on(Events.FINISH, queue => {
      logger.player(queue.id, 'Queue finished');
      queue.textChannel?.send('✅ Queue finished! Use `/play` to add more songs.');
    })
    .on(Events.DISCONNECT, queue => {
      logger.voice(queue.id, 'Disconnected from voice channel');
    })
    .on(Events.INIT_QUEUE, queue => {
      logger.queue(queue.id, 'Queue initialized');
      // Set default queue properties
      queue.volume = 100;
      queue.autoplay = false;
    })
    .on(Events.SEARCH_CANCEL, (message, query) => {
      logger.debug('DisTube', `Search cancelled: ${query}`);
    })
    .on(Events.SEARCH_NO_RESULT, (message, query) => {
      logger.warn('DisTube', `No results for: ${query}`);
    })
    .on(Events.NO_RELATED, (queue, error) => {
      logger.warn('DisTube', `No related songs found for autoplay in ${queue.id}`);
      queue.textChannel?.send('⚠️ Autoplay: No related songs found.');
    })
    .on(Events.FFMPEG_DEBUG, (debug) => {
      // Only log in debug mode
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
