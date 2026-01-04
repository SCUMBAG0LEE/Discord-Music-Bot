/**
 * Format duration in seconds to mm:ss or hh:mm:ss
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration string
 */
function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  
  // Ensure we're working with integers
  seconds = Math.floor(seconds);
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format duration in milliseconds to mm:ss or hh:mm:ss
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string
 */
function formatDurationMs(ms) {
  return formatDuration(Math.floor(ms / 1000));
}

/**
 * Truncate text to a maximum length with ellipsis
 * @param {string} text - Text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} Truncated text
 */
function truncate(text, maxLength = 100) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

/**
 * Parse timestamp string to seconds
 * @param {string} str - Timestamp like "1:30", "90", "2:15:30"
 * @returns {number|null} Seconds or null if invalid
 */
function parseTimestamp(str) {
  const parts = str.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return null;
  
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

module.exports = {
  formatDuration,
  formatDurationMs,
  truncate,
  parseTimestamp
};
