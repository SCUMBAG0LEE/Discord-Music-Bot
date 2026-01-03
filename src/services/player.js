const { createAudioResource, AudioPlayerStatus, StreamType } = require('@discordjs/voice');
const { queueManager } = require('./queueManager');
const youtubeService = require('./youtube');

/**
 * Play a song from the queue
 * @param {string} guildId
 * @param {Object} song
 */
async function playSong(guildId, song) {
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
    // Get stream with type info from play-dl
    const { stream, type } = await youtubeService.getStreamWithType(song.url);
    
    const resource = createAudioResource(stream, {
      inputType: type,
      inlineVolume: true
    });
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
  queue.player.once(AudioPlayerStatus.Idle, async () => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    // Check if 24/7 mode is enabled
    const is247 = currentQueue.twentyFourSeven;
    
    // Check if voice channel is empty (unless 24/7 mode)
    const humanCount = currentQueue.voiceChannel.members.filter(m => !m.user.bot).size;
    if (humanCount === 0 && !is247) {
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
      
      // If queue is empty and autoplay is enabled, add related song
      if (currentQueue.songs.length === 0 && currentQueue.autoplay && song.source === 'youtube') {
        const relatedSong = await getRelatedSong(song, song.requester);
        if (relatedSong) {
          currentQueue.songs.push(relatedSong);
          console.log(`Autoplay: Added "${relatedSong.title}"`);
        }
      }
      
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
  
  // Don't set idle timer in 24/7 mode
  if (queue.twentyFourSeven) return;
  
  // Clear existing timer
  if (queue.idleTimer) {
    clearTimeout(queue.idleTimer);
  }
  
  queue.idleTimer = setTimeout(() => {
    const currentQueue = queueManager.get(guildId);
    if (!currentQueue) return;
    
    // Don't disconnect in 24/7 mode
    if (currentQueue.twentyFourSeven) return;
    
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
  
  try {
    // Get new stream starting at the specified time
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
