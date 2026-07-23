import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

// Helper to convert JSON cookies to Netscape format required by yt-dlp
function convertJsonToNetscape(jsonPath, txtPath) {
    try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        let netscapeStr = "# Netscape HTTP Cookie File\n# Generated dynamically by Discord Music Bot\n";
        
        data.forEach(cookie => {
            const domain = cookie.domain || '';
            const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const path = cookie.path || '/';
            const secure = cookie.secure ? 'TRUE' : 'FALSE';
            // Handle missing expirationDate by defaulting to 0 (session cookie)
            const expiration = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
            const name = cookie.name || '';
            const value = cookie.value || '';
            
            // Netscape format: domain \t includeSubdomains \t path \t secure \t expiration \t name \t value
            netscapeStr += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expiration}\t${name}\t${value}\n`;
        });
        
        fs.writeFileSync(txtPath, netscapeStr);
        return true;
    } catch (error) {
        logger.error('CookieParser', `Failed to convert JSON cookies from ${jsonPath}: ${error.message}`);
        return false;
    }
}

/**
 * Scans the project root for cookie files and returns the yt-dlp arguments array.
 * Automatically converts .json files to .txt for yt-dlp compatibility.
 */
export function getYtDlpArgs(baseArgs) {
    const args = [...baseArgs];
    
    // Add SOCKS5/HTTP Proxy if configured (e.g., YOUTUBE_PROXY environment variable)
    if (process.env.YOUTUBE_PROXY) {
        args.push('--proxy', process.env.YOUTUBE_PROXY);
    }
    
    // Add custom User-Agent if provided (Helps match frozen cookies)
    if (process.env.YOUTUBE_USER_AGENT) {
        args.push('--user-agent', process.env.YOUTUBE_USER_AGENT);
    }
    
    // Support loading cookies securely from an environment variable (crucial for Heroku/Docker)
    if (process.env.YOUTUBE_COOKIES) {
        try {
            let cookieContent = process.env.YOUTUBE_COOKIES.trim();
            
            // 1. Check if the variable is a file path (absolute or relative)
            try {
                // Avoid checking massive Base64 strings as file paths
                if (cookieContent.length < 1000) {
                    const resolvedPath = path.resolve(process.cwd(), cookieContent);
                    if (fs.existsSync(resolvedPath)) {
                        logger.info('CookieParser', `Using cookie path from environment: ${resolvedPath}`);
                        args.push('--cookies', resolvedPath);
                        return args;
                    }
                }
            } catch (e) {
                // Ignore path resolution errors and fall back to string parsing
            }

            const tempCookiePath = path.join(os.tmpdir(), 'youtube-env-cookies.txt');
            
            // 2. Check if it's Base64 encoded (fails to start with typical Netscape header or JSON brackets)
            if (!cookieContent.startsWith('#') && !cookieContent.startsWith('[')) {
                try {
                    const decoded = Buffer.from(cookieContent, 'base64').toString('utf8');
                    // Confirm it decoded into Netscape format or JSON format
                    if (decoded.includes('Netscape') || decoded.startsWith('[')) {
                        cookieContent = decoded;
                        logger.info('CookieParser', 'Successfully decoded Base64 cookies from environment.');
                    }
                } catch (b64Err) {
                    logger.warn('CookieParser', `Failed to decode cookies as Base64, processing raw: ${b64Err.message}`);
                }
            }
            
            // If it starts with JSON brackets, convert it to Netscape
            if (cookieContent.startsWith('[')) {
                const tempJsonPath = path.join(os.tmpdir(), 'youtube-env-cookies.json');
                fs.writeFileSync(tempJsonPath, cookieContent);
                if (convertJsonToNetscape(tempJsonPath, tempCookiePath)) {
                    args.push('--cookies', tempCookiePath);
                    return args;
                }
            } else {
                // Otherwise write it as a Netscape formatted text file
                fs.writeFileSync(tempCookiePath, cookieContent);
                args.push('--cookies', tempCookiePath);
                return args;
            }
        } catch (err) {
            logger.error('CookieParser', `Failed to write cookies from environment variable: ${err.message}`);
        }
    }
    
    // Check for native Netscape formats first
    if (fs.existsSync('./youtube-cookies.txt')) {
        args.push('--cookies', './youtube-cookies.txt');
        return args;
    } else if (fs.existsSync('./cookies.txt')) {
        args.push('--cookies', './cookies.txt');
        return args;
    }
    
    // Check for JSON formats and auto-convert them
    if (fs.existsSync('./youtube-cookies.json')) {
        if (convertJsonToNetscape('./youtube-cookies.json', './youtube-cookies-converted.txt')) {
            args.push('--cookies', './youtube-cookies-converted.txt');
            return args;
        }
    } else if (fs.existsSync('./cookies.json')) {
        if (convertJsonToNetscape('./cookies.json', './cookies-converted.txt')) {
            args.push('--cookies', './cookies-converted.txt');
            return args;
        }
    }
    
    return args;
}
