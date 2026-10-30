/**
 * Format duration in seconds to mm:ss or hh:mm:ss
 */
export function formatDuration(seconds: number): string {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';

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
 */
export function formatDurationMs(ms: number): string {
    return formatDuration(Math.floor(ms / 1000));
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number = 100): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

/**
 * Parse timestamp string to seconds
 */
export function parseTimestamp(str: string): number | null {
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return null;

    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return null;
}

/**
 * Build a visual progress bar string for Now Playing embeds
 */
export function buildProgressBar(elapsedSec: number, totalSec: number, size: number = 16): string {
    if (!totalSec || totalSec <= 0 || isNaN(totalSec)) {
        return '🔘' + '▬'.repeat(size - 1);
    }
    const clampedElapsed = Math.max(0, Math.min(elapsedSec, totalSec));
    const progress = Math.round((clampedElapsed / totalSec) * (size - 1));
    const before = '▬'.repeat(Math.max(0, progress));
    const after = '▬'.repeat(Math.max(0, size - 1 - progress));
    return `${before}🔘${after}`;
}

