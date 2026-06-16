/**
 * Log levels for filtering output
 */
const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Get log level from environment or default to INFO
const currentLevel = LogLevel[process.env.LOG_LEVEL?.toUpperCase()] ?? LogLevel.INFO;

/**
 * Format timestamp for logs
 * @returns {string}
 */
function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Get prefix based on log level
 * @param {string} level
 * @returns {string}
 */
function getPrefix(level) {
  return `[${getTimestamp()}] [${level}]`;
}

/**
 * Logger utility with colored output and levels
 */
const logger = {
  /**
   * Debug level - verbose information for troubleshooting
   */
  debug(category, message, data = null) {
    if (currentLevel > LogLevel.DEBUG) return;
    console.log(`${getPrefix('DEBUG')} [${category}] ${message}`);
    if (data) console.log('  →', data);
  },

  /**
   * Info level - general information
   */
  info(category, message, data = null) {
    if (currentLevel > LogLevel.INFO) return;
    console.log(`${getPrefix('INFO')} [${category}] ${message}`);
    if (data) console.log('  →', data);
  },

  /**
   * Warning level - potential issues
   */
  warn(category, message, data = null) {
    if (currentLevel > LogLevel.WARN) return;
    console.warn(`${getPrefix('WARN')} [${category}] ${message}`);
    if (data) console.warn('  →', data);
  },

  /**
   * Error level - errors that need attention
   */
  error(category, message, error = null) {
    if (currentLevel > LogLevel.ERROR) return;
    console.error(`${getPrefix('ERROR')} [${category}] ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.error('  → Error:', error.message);
        if (currentLevel === LogLevel.DEBUG && error.stack) {
          console.error(error.stack);
        }
      } else {
        console.error('  →', error);
      }
    }
  },

  /**
   * Success level - successful operations
   */
  success(category, message) {
    console.log(`${getPrefix('SUCCESS')} [${category}] ${message}`);
  },

  /**
   * Log command execution
   * @param {string} commandName 
   * @param {string} userId 
   * @param {string} guildId 
   * @param {Object} [options] - Command options
   */
  command(commandName, userId, guildId, options = {}) {
    const optStr = Object.keys(options).length > 0 
      ? ` | options: ${JSON.stringify(options)}`
      : '';
    this.info('Command', `/${commandName} by ${userId} in ${guildId}${optStr}`);
  },

  /**
   * Log URL detection/routing
   * @param {string} url 
   * @param {string} detectedType 
   */
  urlDetection(url, detectedType) {
    const truncatedUrl = url.length > 80 ? url.substring(0, 80) + '...' : url;
    this.debug('URLDetect', `"${truncatedUrl}" → ${detectedType}`);
  },

  /**
   * Log queue operations
   * @param {string} guildId 
   * @param {string} action 
   * @param {Object} [details] 
   */
  queue(guildId, action, details = {}) {
    const detailStr = Object.keys(details).length > 0 
      ? ` | ${JSON.stringify(details)}`
      : '';
    this.debug('Queue', `[${guildId}] ${action}${detailStr}`);
  },

  /**
   * Log player events
   * @param {string} guildId 
   * @param {string} event 
   * @param {Object} [details] 
   */
  player(guildId, event, details = {}) {
    this.debug('Player', `[${guildId}] ${event}`, Object.keys(details).length > 0 ? details : null);
  },

  /**
   * Log voice connection events
   * @param {string} guildId 
   * @param {string} event 
   */
  voice(guildId, event) {
    this.debug('Voice', `[${guildId}] ${event}`);
  },

  /**
   * Log streaming operations
   * @param {string} source 
   * @param {string} url 
   * @param {string} status 
   */
  stream(source, url, status) {
    const truncatedUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
    this.debug('Stream', `[${source}] ${truncatedUrl} → ${status}`);
  }
};

export { logger, LogLevel };
