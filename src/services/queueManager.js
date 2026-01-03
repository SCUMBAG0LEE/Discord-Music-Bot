const { joinVoiceChannel, createAudioPlayer } = require('@discordjs/voice');

/**
 * Manages music queues for all guilds
 */
class QueueManager {
  constructor() {
    /** @type {Map<string, GuildQueue>} */
    this.queues = new Map();
  }

  /**
   * Get or create a queue for a guild
   * @param {string} guildId
   * @param {import('discord.js').VoiceChannel} voiceChannel
   * @returns {GuildQueue}
   */
  getOrCreate(guildId, voiceChannel) {
    let queue = this.queues.get(guildId);
    
    if (!queue) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      });
      
      const player = createAudioPlayer();
      connection.subscribe(player);
      
      queue = {
        voiceChannel,
        connection,
        player,
        songs: [],
        volume: 1.0,
        loop: false,
        votes: [],
        idleTimer: null,
        resource: null,
        nowPlayingStart: null,
        autoplay: false,
        twentyFourSeven: false
      };
      
      this.queues.set(guildId, queue);
    }
    
    // Clear idle timer when queue is accessed
    if (queue.idleTimer) {
      clearTimeout(queue.idleTimer);
      queue.idleTimer = null;
    }
    
    return queue;
  }

  /**
   * Get existing queue for a guild
   * @param {string} guildId
   * @returns {GuildQueue|undefined}
   */
  get(guildId) {
    return this.queues.get(guildId);
  }

  /**
   * Check if a guild has an active queue
   * @param {string} guildId
   * @returns {boolean}
   */
  has(guildId) {
    return this.queues.has(guildId);
  }

  /**
   * Delete a guild's queue and cleanup
   * @param {string} guildId
   */
  delete(guildId) {
    const queue = this.queues.get(guildId);
    if (queue) {
      if (queue.idleTimer) {
        clearTimeout(queue.idleTimer);
      }
      try {
        queue.connection.destroy();
      } catch (e) {
        // Connection may already be destroyed
      }
      this.queues.delete(guildId);
    }
  }

  /**
   * Add song(s) to queue
   * @param {string} guildId
   * @param {Song|Song[]} songs
   */
  addSongs(guildId, songs) {
    const queue = this.queues.get(guildId);
    if (!queue) return;
    
    if (Array.isArray(songs)) {
      queue.songs.push(...songs);
    } else {
      queue.songs.push(songs);
    }
  }

  /**
   * Clear votes for current song
   * @param {string} guildId
   */
  clearVotes(guildId) {
    const queue = this.queues.get(guildId);
    if (queue) {
      queue.votes = [];
    }
  }

  /**
   * Add vote to skip current song
   * @param {string} guildId
   * @param {string} userId
   * @returns {{ added: boolean, current: number, threshold: number }}
   */
  addVote(guildId, userId) {
    const queue = this.queues.get(guildId);
    if (!queue) return { added: false, current: 0, threshold: 0 };
    
    if (queue.votes.includes(userId)) {
      return { added: false, current: queue.votes.length, threshold: this.getVoteThreshold(guildId) };
    }
    
    queue.votes.push(userId);
    return { added: true, current: queue.votes.length, threshold: this.getVoteThreshold(guildId) };
  }

  /**
   * Get the vote threshold for skipping
   * @param {string} guildId
   * @returns {number}
   */
  getVoteThreshold(guildId) {
    const queue = this.queues.get(guildId);
    if (!queue) return 1;
    
    const voiceCount = queue.voiceChannel.members.filter(m => !m.user.bot).size;
    return Math.ceil(voiceCount / 2);
  }

  /**
   * Shuffle the queue (preserving current song)
   * @param {string} guildId
   */
  shuffle(guildId) {
    const queue = this.queues.get(guildId);
    if (!queue || queue.songs.length < 2) return;
    
    const current = queue.songs.shift();
    for (let i = queue.songs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }
    queue.songs.unshift(current);
  }

  /**
   * Clear queue except current song
   * @param {string} guildId
   */
  clearQueue(guildId) {
    const queue = this.queues.get(guildId);
    if (queue) {
      queue.songs = queue.songs.slice(0, 1);
    }
  }

  /**
   * Remove song at index
   * @param {string} guildId
   * @param {number} index - 0-based index
   * @returns {Song|null}
   */
  removeSong(guildId, index) {
    const queue = this.queues.get(guildId);
    if (!queue || index < 1 || index >= queue.songs.length) return null;
    
    return queue.songs.splice(index, 1)[0];
  }

  /**
   * Move a song from one position to another
   * @param {string} guildId
   * @param {number} from - 0-based index
   * @param {number} to - 0-based index
   * @returns {Song|null}
   */
  moveSong(guildId, from, to) {
    const queue = this.queues.get(guildId);
    if (!queue) return null;
    
    const [moved] = queue.songs.splice(from, 1);
    queue.songs.splice(to, 0, moved);
    return moved;
  }

  /**
   * Jump to a specific song (removes songs before it)
   * @param {string} guildId
   * @param {number} index - 0-based index
   */
  jumpTo(guildId, index) {
    const queue = this.queues.get(guildId);
    if (!queue) return;
    
    queue.songs.splice(0, index);
    queue.votes = [];
  }
}

/**
 * @typedef {Object} Song
 * @property {string} title
 * @property {string} url
 * @property {number} duration
 * @property {string} requester
 * @property {string} [source]
 * @property {string} [sourceUrl]
 */

/**
 * @typedef {Object} GuildQueue
 * @property {import('discord.js').VoiceChannel} voiceChannel
 * @property {import('@discordjs/voice').VoiceConnection} connection
 * @property {import('@discordjs/voice').AudioPlayer} player
 * @property {Song[]} songs
 * @property {number} volume
 * @property {boolean} loop
 * @property {string[]} votes
 * @property {NodeJS.Timeout|null} idleTimer
 * @property {import('@discordjs/voice').AudioResource|null} resource
 * @property {number|null} nowPlayingStart
 */

// Singleton instance
const queueManager = new QueueManager();

module.exports = { queueManager, QueueManager };
