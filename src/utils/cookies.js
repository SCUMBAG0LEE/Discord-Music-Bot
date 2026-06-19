import fs from 'fs';
import path from 'path';
import os from 'os';

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
        console.error(`[CookieParser] Failed to convert JSON cookies from ${jsonPath}:`, error.message);
        return false;
    }
}

/**
 * Scans the project root for cookie files and returns the yt-dlp arguments array.
 * Automatically converts .json files to .txt for yt-dlp compatibility.
 */
export function getYtDlpArgs(baseArgs) {
    const args = [...baseArgs];
    
    // Support loading cookies securely from an environment variable (crucial for Heroku/Docker)
    if (process.env.YOUTUBE_COOKIES) {
        const tempCookiePath = path.join(os.tmpdir(), 'youtube-env-cookies.txt');
        try {
            fs.writeFileSync(tempCookiePath, process.env.YOUTUBE_COOKIES.trim());
            args.push('--cookies', tempCookiePath);
            return args;
        } catch (err) {
            console.error('[CookieParser] Failed to write cookies from environment variable:', err.message);
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
