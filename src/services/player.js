const { createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { queueManager } = require('./queueManager');
const youtubeService = require('./youtube');
const play = require('play-dl');
const { logger } = require('../utils/logger');

/**
 * Get stream for a song based on its source
 * @param {Object} song
 * @param {number} [seekTime=0]
 * @returns {Promise<{stream: import('stream').Readable, type: string}>}
 */
async function getStreamForSong(song, seekTime = 0) {
  logger.debug('Player', `Getting stream for: ${song.title}`, {
    source: song.source,
    url: song.url?.substring(0, 80),
    isStream: song.isStream,
    seekTime
  });

  // Handle radio/direct streams - use play-dl for arbitrary URLs
  if (song.isStream || song.source === 'stream') {
    // play-dl can handle arbitrary stream URLs
    try {
      logger.stream('stream', song.url, 'attempting play-dl');
      const streamData = await play.stream(song.url);
      logger.stream('stream', song.url, 'success');
      return {
        stream: streamData.stream,
        type: streamData.type
      };
    } catch (err) {
      logger.warn('Player', `play-dl stream failed, using fetch fallback: ${err.message}`);
      // Fallback: create resource from URL directly using fetch
      const response = await fetch(song.url);
      return {
        stream: response.body,
        type: StreamType.Arbitrary
      };
    }
  }
  
  // Handle SoundCloud
  if (song.source === 'soundcloud') {
    logger.stream('soundcloud', song.url, 'attempting');
    const streamData = await play.stream(song.url);
    logger.stream('soundcloud', song.url, 'success');
    return {
      stream: streamData.stream,
      type: streamData.type
    };
  }
  
  // Default: YouTube (handles youtube and spotify which are converted to youtube)
  logger.stream('youtube', song.url, 'attempting');
  return youtubeService.getStreamWithType(song.url, seekTime);
}

/**
 * Play a song from the queue
 * @param {string} guildId
 * @param {Object} song
 */
async function playSong(guildId, song) {
  const queue = queueManager.get(guildId);
  
  if (!queue) {
    logger.warn('Player', `No queue found for guild ${guildId}`);
    return;
  }
  
  // If no song, set idle timer for auto-disconnect
  if (!song) {
    logger.player(guildId, 'queue empty, starting idle timer');
    startIdleTimer(guildId);
    return;
  }
  
  // Clear idle timer since we're playing
  clearIdleTimer(guildId);
  
  logger.player(guildId, 'playSong', { 
    title: song.title, 
    source: song.source, 
    url: song.url?.substring(0, 80) 
  });
  
  try {
    // Get stream based on song source
    const { stream, type } = await getStreamForSong(song);
    logger.debug('Player', `Stream acquired, type: ${type}`);
    
    const resource = createAudioResource(stream, {
      inputType: type,
      inlineVolume: true
    });
    resource.volume.setVolume(queue.volume);
    
    queue.resource = resource;
    queue.nowPlayingStart = Date.now();
    queue.player.play(resource);
    
    logger.success('Player', `Now playing: ${song.title}`);
    
    // Set up event handlers
    setupPlayerEvents(guildId, song);
  } catch (err) {
    logger.error('Player', `Error playing song: ${song.title}`, err);
    logger.debug('Player', 'Song object that failed:', song);
    // Skip to next song on error
    queue.songs.shift();
    playSong(guildId, queue.songs[0]);
  }
}

/**
 * Set up player event handlers for a song
 * @param {string} guildId
 * @param {Object} song
 */
function setupPlayerEvents(guildId, song) {
  const queue = queueManager.get(guildId);
  if (!queue) return;
  
  // Remove any existing listeners to prevent memory leaks
  queue.player.removeAllListeners(AudioPlayerStatus.Idle);
  queue.player.removeAllListeners('error');
  
  // Handle song end
  queue.player.once(AudioPlayerStatus.Idle, async () => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    logger.player(guildId, 'song ended (idle)', { title: song.title });
    
    // Check if 24/7 mode is enabled
    const is247 = currentQueue.twentyFourSeven;
    
    // Check if voice channel is empty (unless 24/7 mode)
    const humanCount = currentQueue.voiceChannel.members.filter(m => !m.user.bot).size;
    if (humanCount === 0 && !is247) {
      logger.voice(guildId, 'disconnecting: no users in voice channel');
      queueManager.delete(guildId);
      return;
    }
    
    // Handle loop or next song
    if (currentQueue.loop) {
      logger.player(guildId, 'looping song');
      playSong(guildId, song);
    } else {
      currentQueue.songs.shift();
      currentQueue.votes = [];
      
      // If queue is empty and autoplay is enabled, add related song
      if (currentQueue.songs.length === 0 && currentQueue.autoplay && song.source === 'youtube') {
        logger.debug('Player', 'Queue empty, autoplay enabled - fetching related song');
        const relatedSong = await getRelatedSong(song, song.requester);
        if (relatedSong) {
          currentQueue.songs.push(relatedSong);
          logger.info('Player', `Autoplay: Added "${relatedSong.title}"`);
        }
      }
      
      logger.player(guildId, 'playing next song', { 
        remaining: currentQueue.songs.length,
        next: currentQueue.songs[0]?.title 
      });
      playSong(guildId, currentQueue.songs[0]);
    }
  });
  
  // Handle errors
  queue.player.once('error', error => {
    logger.error('Player', `Audio player error in guild ${guildId}`, error);
    const currentQueue = queueManager.get(guildId);
    if (currentQueue) {
      currentQueue.songs.shift();
      playSong(guildId, currentQueue.songs[0]);
    }
  });
}

/**
 * Start idle timer for auto-disconnect
 * @param {string} guildId
 */
function startIdleTimer(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return;
  
  // Don't set idle timer in 24/7 mode
  if (queue.twentyFourSeven) {
    logger.debug('Player', `[${guildId}] 24/7 mode enabled, skipping idle timer`);
    return;
  }
  
  // Clear existing timer
  if (queue.idleTimer) {
    clearTimeout(queue.idleTimer);
  }
  
  logger.debug('Player', `[${guildId}] Starting 60s idle timer`);
  
  queue.idleTimer = setTimeout(() => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    // Don't disconnect in 24/7 mode
    if (currentQueue.twentyFourSeven) return;
    
    const humanCount = currentQueue.voiceChannel.members.filter(m => !m.user.bot).size;
    if (humanCount === 0) {
      logger.voice(guildId, 'disconnecting: no users in voice channel');
    } else {
      logger.voice(guildId, 'disconnecting: idle for 1 minute');
    }
    
    queueManager.delete(guildId);
  }, 60000); // 1 minute
}

/**
 * Clear idle timer
 * @param {string} guildId
 */
function clearIdleTimer(guildId) {
  const queue = queueManager.get(guildId);
  if (queue?.idleTimer) {
    clearTimeout(queue.idleTimer);
    queue.idleTimer = null;
  }
}

/**
 * Set volume for current playback
 * @param {string} guildId
 * @param {number} level - Volume level (0.0 to 5.0)
 * @returns {boolean} Success
 */
function setVolume(guildId, level) {
  const queue = queueManager.get(guildId);
  if (!queue) return false;
  
  queue.volume = level;
  if (queue.resource?.volume) {
    queue.resource.volume.setVolume(level);
  }
  return true;
}

/**
 * Pause playback
 * @param {string} guildId
 * @returns {boolean} Success
 */
function pause(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return false;
  
  queue.player.pause();
  return true;
}

/**
 * Resume playback
 * @param {string} guildId
 * @returns {boolean} Success
 */
function resume(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return false;
  
  queue.player.unpause();
  return true;
}

/**
 * Stop playback
 * @param {string} guildId
 * @returns {boolean} Success
 */
function stop(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return false;
  
  queue.player.stop();
  return true;
}

/**
 * Skip current song
 * @param {string} guildId
 * @returns {boolean} Success
 */
function skip(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return false;
  
  queue.player.stop(); // This triggers the Idle event which handles next song
  return true;
}

/**
 * Toggle loop mode
 * @param {string} guildId
 * @returns {boolean|null} New loop state or null if no queue
 */
function toggleLoop(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue) return null;
  
  queue.loop = !queue.loop;
  return queue.loop;
}

/**
 * Seek to a specific timestamp
 * @param {string} guildId
 * @param {number} seconds - Timestamp in seconds
 * @returns {Promise<boolean>} Success
 */
async function seekTo(guildId, seconds) {
  const queue = queueManager.get(guildId);
  if (!queue || queue.songs.length === 0) return false;
  
  const song = queue.songs[0];
  
  // Can't seek in streams or SoundCloud (play-dl limitation)
  if (song.isStream || song.source === 'stream' || song.source === 'soundcloud') {
    return false;
  }
  
  try {
    // Get new stream starting at the specified time (only YouTube supports seek)
    const { stream, type } = await youtubeService.getStreamWithType(song.url, seconds);
    
    const resource = createAudioResource(stream, {
      inputType: type,
      inlineVolume: true
    });
    resource.volume.setVolume(queue.volume);
    
    queue.resource = resource;
    queue.nowPlayingStart = Date.now() - (seconds * 1000); // Adjust start time
    queue.player.play(resource);
    
    return true;
  } catch (err) {
    console.error(`Seek error: ${err.message}`);
    return false;
  }
}

/**
 * Replay current song from beginning
 * @param {string} guildId
 * @returns {Promise<boolean>} Success
 */
async function replay(guildId) {
  const queue = queueManager.get(guildId);
  if (!queue || queue.songs.length === 0) return false;
  
  const song = queue.songs[0];
  
  try {
    // Just replay from the start
    await playSong(guildId, song);
    return true;
  } catch (err) {
    console.error(`Replay error: ${err.message}`);
    return false;
  }
}

/**
 * Get a related song for autoplay
 * @param {Object} song - Current song
 * @param {string} requesterId - User ID to assign as requester
 * @returns {Promise<Object|null>}
 */
async function getRelatedSong(song, requesterId) {
  try {
    // Search for related content based on the song title
    const searchQuery = song.title.replace(/\(.*?\)|\[.*?\]/g, '').trim();
    const results = await youtubeService.search(searchQuery + ' music', 5);
    
    // Find a different song (not the same URL)
    const related = results.find(r => r.url !== song.url);
    
    if (related) {
      return {
        title: related.title,
        url: related.url,
        duration: related.duration || 0,
        requester: requesterId,
        source: 'youtube',
        sourceUrl: related.url,
        thumbnail: related.thumbnail || null,
        autoplay: true
      };
    }
    
    return null;
  } catch (err) {
    console.error('Autoplay search error:', err.message);
    return null;
  }
}

module.exports = {
  playSong,
  setVolume,
  pause,
  resume,
  stop,
  skip,
  toggleLoop,
  seekTo,
  replay,
  clearIdleTimer
};
