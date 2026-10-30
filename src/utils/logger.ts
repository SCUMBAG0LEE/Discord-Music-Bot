export const LogLevel: Record<string, number> = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const envLevelKey = process.env.LOG_LEVEL?.toUpperCase() ?? 'INFO';
const currentLevel: number = LogLevel[envLevelKey] ?? LogLevel.INFO;

function getTimestamp(): string {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function getPrefix(level: string): string {
    return `[${getTimestamp()}] [${level}]`;
}

export const logger = {
    debug(category: string, message: string, data: unknown = null): void {
        if (currentLevel > LogLevel.DEBUG) return;
        console.log(`${getPrefix('DEBUG')} [${category}] ${message}`);
        if (data) console.log('  →', data);
    },

    info(category: string, message: string, data: unknown = null): void {
        if (currentLevel > LogLevel.INFO) return;
        console.log(`${getPrefix('INFO')} [${category}] ${message}`);
        if (data) console.log('  →', data);
    },

    warn(category: string, message: string, data: unknown = null): void {
        if (currentLevel > LogLevel.WARN) return;
        console.warn(`${getPrefix('WARN')} [${category}] ${message}`);
        if (data) console.warn('  →', data);
    },

    error(category: string, message: string, error: unknown = null): void {
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

    success(category: string, message: string): void {
        console.log(`${getPrefix('SUCCESS')} [${category}] ${message}`);
    },

    command(commandName: string, userId: string, guildId: string, options: Record<string, unknown> = {}): void {
        const optStr = Object.keys(options).length > 0
            ? ` | options: ${JSON.stringify(options)}`
            : '';
        this.info('Command', `/${commandName} by ${userId} in ${guildId}${optStr}`);
    },

    urlDetection(url: string, detectedType: string): void {
        const truncatedUrl = url.length > 80 ? url.substring(0, 80) + '...' : url;
        this.debug('URLDetect', `"${truncatedUrl}" → ${detectedType}`);
    },

    queue(guildId: string, action: string, details: Record<string, unknown> = {}): void {
        const detailStr = Object.keys(details).length > 0
            ? ` | ${JSON.stringify(details)}`
            : '';
        this.debug('Queue', `[${guildId}] ${action}${detailStr}`);
    },

    player(guildId: string, event: string, details: Record<string, unknown> = {}): void {
        this.debug('Player', `[${guildId}] ${event}`, Object.keys(details).length > 0 ? details : null);
    },

    voice(guildId: string, event: string): void {
        this.debug('Voice', `[${guildId}] ${event}`);
    },

    stream(source: string, url: string, status: string): void {
        const truncatedUrl = url.length > 60 ? url.substring(0, 60) + '...' : url;
        this.debug('Stream', `[${source}] ${truncatedUrl} → ${status}`);
    }
};

