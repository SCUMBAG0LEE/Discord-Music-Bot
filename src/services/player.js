const { createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const { queueManager } = require('./queueManager');
const youtubeService = require('./youtube');

/**
 * Play a song from the queue
 * @param {string} guildId
 * @param {Object} song
 */
function playSong(guildId, song) {
  const queue = queueManager.get(guildId);
  
  if (!queue) return;
  
  // If no song, set idle timer for auto-disconnect
  if (!song) {
    startIdleTimer(guildId);
    return;
  }
  
  // Clear idle timer since we're playing
  clearIdleTimer(guildId);
  
  try {
    const stream = youtubeService.createStream(song.url);
    const resource = createAudioResource(stream, { inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    
    queue.resource = resource;
    queue.nowPlayingStart = Date.now();
    queue.player.play(resource);
    
    // Set up event handlers
    setupPlayerEvents(guildId, song);
  } catch (err) {
    console.error(`Error playing song: ${err.message}`);
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
  queue.player.once(AudioPlayerStatus.Idle, () => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    // Check if voice channel is empty
    const humanCount = currentQueue.voiceChannel.members.filter(m => !m.user.bot).size;
    if (humanCount === 0) {
      console.log('Disconnecting: no users in voice channel');
      queueManager.delete(guildId);
      return;
    }
    
    // Handle loop or next song
    if (currentQueue.loop) {
      playSong(guildId, song);
    } else {
      currentQueue.songs.shift();
      currentQueue.votes = [];
      playSong(guildId, currentQueue.songs[0]);
    }
  });
  
  // Handle errors
  queue.player.once('error', error => {
    console.error(`Player error: ${error.message}`);
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
  
  // Clear existing timer
  if (queue.idleTimer) {
    clearTimeout(queue.idleTimer);
  }
  
  queue.idleTimer = setTimeout(() => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    const humanCount = currentQueue.voiceChannel.members.filter(m => !m.user.bot).size;
    if (humanCount === 0) {
      console.log('Disconnecting: no users in voice channel');
    } else {
      console.log('Disconnecting: idle for 1 minute');
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

module.exports = {
  playSong,
  setVolume,
  pause,
  resume,
  stop,
  skip,
  toggleLoop,
  clearIdleTimer
};
