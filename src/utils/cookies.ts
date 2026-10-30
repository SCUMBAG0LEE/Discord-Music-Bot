import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

interface JsonCookie {
    domain?: string;
    path?: string;
    secure?: boolean;
    expirationDate?: number;
    name?: string;
    value?: string;
}

// Cache resolved cookie path in memory for 60s to avoid rewriting disk files on every yt-dlp invocation
let cachedCookiePath: string | null = null;
let cachedCookieTimestamp = 0;
let cachedCookieEnvValue: string | undefined = undefined;
const COOKIE_CACHE_TTL_MS = 60_000;

// Helper to convert JSON cookies to Netscape format required by yt-dlp
function convertJsonToNetscape(jsonPath: string, txtPath: string): boolean {
    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as JsonCookie[];
        let netscapeStr = "# Netscape HTTP Cookie File\n# Generated dynamically by Discord Music Bot\n";

        data.forEach(cookie => {
            const domain = cookie.domain || '';
            const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const cookiePath = cookie.path || '/';
            const secure = cookie.secure ? 'TRUE' : 'FALSE';
            const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
            const name = cookie.name || '';
            const value = cookie.value || '';

            netscapeStr += `${domain}\t${includeSubdomains}\t${cookiePath}\t${secure}\t${expiration}\t${name}\t${value}\n`;
        });

        fs.writeFileSync(txtPath, netscapeStr);
        return true;
    } catch (error: any) {
        logger.error('CookieParser', `Failed to convert JSON cookies from ${jsonPath}: ${error.message}`);
        return false;
    }
}

function resolveCookieFilePath(): string | null {
    const now = Date.now();
    const currentEnv = process.env.YOUTUBE_COOKIES;

    if (
        cachedCookieTimestamp > 0 &&
        now - cachedCookieTimestamp < COOKIE_CACHE_TTL_MS &&
        cachedCookieEnvValue === currentEnv &&
        (cachedCookiePath === null || fs.existsSync(cachedCookiePath))
    ) {
        return cachedCookiePath;
    }

    cachedCookieTimestamp = now;
    cachedCookieEnvValue = currentEnv;

    if (currentEnv) {
        try {
            let cookieContent = currentEnv.trim();

            // 1. Check if the variable is a file path (absolute or relative)
            try {
                if (cookieContent.length < 1000) {
                    const resolvedPath = path.resolve(process.cwd(), cookieContent);
                    if (fs.existsSync(resolvedPath)) {
                        logger.info('CookieParser', `Using cookie path from environment: ${resolvedPath}`);
                        cachedCookiePath = resolvedPath;
                        return cachedCookiePath;
                    }
                }
            } catch {
                // Ignore path resolution errors and fall back to string parsing
            }

            const tempCookiePath = path.join(os.tmpdir(), 'youtube-env-cookies.txt');

            // 2. Check if it's Base64 encoded (fails to start with typical Netscape header or JSON brackets)
            if (!cookieContent.startsWith('#') && !cookieContent.startsWith('[')) {
                try {
                    const decoded = Buffer.from(cookieContent, 'base64').toString('utf8');
                    if (decoded.includes('Netscape') || decoded.startsWith('[')) {
                        cookieContent = decoded;
                        logger.info('CookieParser', 'Successfully decoded Base64 cookies from environment.');
                    }
                } catch (b64Err: any) {
                    logger.warn('CookieParser', `Failed to decode cookies as Base64, processing raw: ${b64Err.message}`);
                }
            }

            // If it starts with JSON brackets, convert it to Netscape
            if (cookieContent.startsWith('[')) {
                const tempJsonPath = path.join(os.tmpdir(), 'youtube-env-cookies.json');
                fs.writeFileSync(tempJsonPath, cookieContent);
                if (convertJsonToNetscape(tempJsonPath, tempCookiePath)) {
                    cachedCookiePath = tempCookiePath;
                    return cachedCookiePath;
                }
            } else {
                fs.writeFileSync(tempCookiePath, cookieContent);
                cachedCookiePath = tempCookiePath;
                return cachedCookiePath;
            }
        } catch (err: any) {
            logger.error('CookieParser', `Failed to write cookies from environment variable: ${err.message}`);
        }
    }

    // Check for native Netscape formats first
    if (fs.existsSync('./youtube-cookies.txt')) {
        cachedCookiePath = './youtube-cookies.txt';
        return cachedCookiePath;
    } else if (fs.existsSync('./cookies.txt')) {
        cachedCookiePath = './cookies.txt';
        return cachedCookiePath;
    }

    // Check for JSON formats and auto-convert them
    if (fs.existsSync('./youtube-cookies.json')) {
        if (convertJsonToNetscape('./youtube-cookies.json', './youtube-cookies-converted.txt')) {
            cachedCookiePath = './youtube-cookies-converted.txt';
            return cachedCookiePath;
        }
    } else if (fs.existsSync('./cookies.json')) {
        if (convertJsonToNetscape('./cookies.json', './cookies-converted.txt')) {
            cachedCookiePath = './cookies-converted.txt';
            return cachedCookiePath;
        }
    }

    cachedCookiePath = null;
    return null;
}

/**
 * Scans the project root / environment for cookie files and returns the yt-dlp arguments array.
 * Automatically converts .json files to .txt for yt-dlp compatibility and caches the result.
 */
export function getYtDlpArgs(baseArgs: string[]): string[] {
    const args = [...baseArgs];

    // Add default retry arguments to handle transient proxy timeouts or rate limits
    if (!args.includes('--retries')) {
        args.push('--retries', '10', '--fragment-retries', '10');
    }

    // Add SOCKS5/HTTP Proxy if configured
    if (process.env.YOUTUBE_PROXY) {
        args.push('--proxy', process.env.YOUTUBE_PROXY);
    }

    // Add custom User-Agent if provided (Helps match frozen cookies)
    if (process.env.YOUTUBE_USER_AGENT) {
        args.push('--user-agent', process.env.YOUTUBE_USER_AGENT);
    }

    // Add YouTube PO Token if configured
    if (process.env.YOUTUBE_PO_TOKEN && process.env.YOUTUBE_PO_TOKEN.trim().length > 0) {
        args.push('--extractor-args', `youtube:po_token=${process.env.YOUTUBE_PO_TOKEN.trim()}`);
    }

    const cookiePath = resolveCookieFilePath();
    if (cookiePath) {
        args.push('--cookies', cookiePath);
    }

    return args;
}

