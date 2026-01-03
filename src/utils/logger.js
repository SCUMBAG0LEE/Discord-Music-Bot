const chalk = require('chalk');

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
 * Get colored prefix based on log level
 * @param {string} level
 * @returns {string}
 */
function getPrefix(level) {
  const timestamp = chalk.gray(`[${getTimestamp()}]`);
  
  switch (level) {
    case 'DEBUG':
      return `${timestamp} ${chalk.magenta('[DEBUG]')}`;
    case 'INFO':
      return `${timestamp} ${chalk.blue('[INFO]')}`;
    case 'WARN':
      return `${timestamp} ${chalk.yellow('[WARN]')}`;
    case 'ERROR':
      return `${timestamp} ${chalk.red('[ERROR]')}`;
    case 'SUCCESS':
      return `${timestamp} ${chalk.green('[SUCCESS]')}`;
    default:
      return timestamp;
  }
}

/**
 * Logger utility with colored output and levels
 */
const logger = {
  /**
   * Debug level - verbose information for troubleshooting
   * @param {string} category - Category/module name
   * @param {string} message - Log message
   * @param {Object} [data] - Optional data to log
   */
  debug(category, message, data = null) {
    if (currentLevel > LogLevel.DEBUG) return;
    const cat = chalk.cyan(`[${category}]`);
    console.log(`${getPrefix('DEBUG')} ${cat} ${message}`);
    if (data) console.log(chalk.gray('  →'), data);
  },

  /**
   * Info level - general information
   * @param {string} category - Category/module name
   * @param {string} message - Log message
   * @param {Object} [data] - Optional data to log
   */
  info(category, message, data = null) {
    if (currentLevel > LogLevel.INFO) return;
    const cat = chalk.cyan(`[${category}]`);
    console.log(`${getPrefix('INFO')} ${cat} ${message}`);
    if (data) console.log(chalk.gray('  →'), data);
  },

  /**
   * Warning level - potential issues
   * @param {string} category - Category/module name
   * @param {string} message - Log message
   * @param {Object} [data] - Optional data to log
   */
  warn(category, message, data = null) {
    if (currentLevel > LogLevel.WARN) return;
    const cat = chalk.cyan(`[${category}]`);
    console.warn(`${getPrefix('WARN')} ${cat} ${message}`);
    if (data) console.warn(chalk.gray('  →'), data);
  },

  /**
   * Error level - errors that need attention
   * @param {string} category - Category/module name
   * @param {string} message - Log message
   * @param {Error|Object} [error] - Optional error object
   */
  error(category, message, error = null) {
    if (currentLevel > LogLevel.ERROR) return;
    const cat = chalk.cyan(`[${category}]`);
    console.error(`${getPrefix('ERROR')} ${cat} ${message}`);
    if (error) {
      if (error instanceof Error) {
        console.error(chalk.red('  → Error:'), error.message);
        if (currentLevel === LogLevel.DEBUG && error.stack) {
          console.error(chalk.gray(error.stack));
        }
      } else {
        console.error(chalk.gray('  →'), error);
      }
    }
  },

  /**
   * Success level - successful operations
   * @param {string} category - Category/module name
   * @param {string} message - Log message
   */
  success(category, message) {
    const cat = chalk.cyan(`[${category}]`);
    console.log(`${getPrefix('SUCCESS')} ${cat} ${message}`);
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
      ? chalk.gray(` | options: ${JSON.stringify(options)}`)
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
    this.debug('URLDetect', `"${truncatedUrl}" → ${chalk.yellow(detectedType)}`);
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

module.exports = { logger, LogLevel };
