const chalk = require('chalk');

const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

const currentLevel = LogLevel[process.env.LOG_LEVEL?.toUpperCase()] ?? LogLevel.INFO;

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function getPrefix(level) {
  const timestamp = chalk.gray(`[${getTimestamp()}]`);
  
  switch (level) {
    case 'DEBUG': return `${timestamp} ${chalk.magenta('[DEBUG]')}`;
    case 'INFO': return `${timestamp} ${chalk.blue('[INFO]')}`;
    case 'WARN': return `${timestamp} ${chalk.yellow('[WARN]')}`;
    case 'ERROR': return `${timestamp} ${chalk.red('[ERROR]')}`;
    case 'SUCCESS': return `${timestamp} ${chalk.green('[SUCCESS]')}`;
    default: return timestamp;
  }
}

const logger = {
  debug(category, message, data = null) {
    if (currentLevel > LogLevel.DEBUG) return;
    console.log(`${getPrefix('DEBUG')} ${chalk.cyan(`[${category}]`)} ${message}`);
    if (data) console.log(chalk.gray('  →'), data);
  },

  info(category, message, data = null) {
    if (currentLevel > LogLevel.INFO) return;
    console.log(`${getPrefix('INFO')} ${chalk.cyan(`[${category}]`)} ${message}`);
    if (data) console.log(chalk.gray('  →'), data);
  },

  warn(category, message, data = null) {
    if (currentLevel > LogLevel.WARN) return;
    console.warn(`${getPrefix('WARN')} ${chalk.cyan(`[${category}]`)} ${message}`);
    if (data) console.warn(chalk.gray('  →'), data);
  },

  error(category, message, error = null) {
    if (currentLevel > LogLevel.ERROR) return;
    console.error(`${getPrefix('ERROR')} ${chalk.cyan(`[${category}]`)} ${message}`);
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

  success(category, message) {
    console.log(`${getPrefix('SUCCESS')} ${chalk.cyan(`[${category}]`)} ${message}`);
  }
};

module.exports = { logger, LogLevel };
