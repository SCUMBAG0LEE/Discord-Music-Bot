# 🎵 Discord Music Bot

A feature-rich, ultra-high-performance Discord music bot with **YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch, and Radio** support. Rebuilt from the ground up using **Seyfert** and a custom **native yt-dlp child-process bridge** for maximum reliability and memory efficiency.

## ✨ Features

### 🎶 Multi-Platform Support
- **YouTube** — Direct stream extraction with automatic age-restriction bypass
- **Spotify** — Tracks, playlists, and albums (auto-proxied to YouTube)
- **SoundCloud** — Tracks, playlists, and interactive search
- **Bandcamp** — Tracks and albums
- **Vimeo** — Videos
- **Twitch** — Live streams (purple Streaming badge when shown in status)
- **Dailymotion** — Videos
- **Direct HTTP** — MP3, FLAC, OGG, WAV, M3U/PLS streams, and other audio URLs
- **Radio/Streams** — Built-in presets and custom stream URLs
- **1000+ sites** — Any URL [supported by yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) works automatically

### 📋 Queue Management
- Paginated queue display
- Shuffle, move, remove, and jump
- **Loop Mode** — Off, repeat song, or repeat queue
- **Autoplay** — Automatically queue related songs when queue ends

### ❤️ Database & Favorites
- **Hybrid Storage Engine** — Uses local `bun:sqlite` for local development, and automatically transitions to **Cloudflare D1** serverless SQLite for ephemeral environments (like Heroku) based on environment variables.
- **Server Settings Persistence** — Per-server config (skip ratio, DJ role, volume, channel locks) is persisted in the database as well.
- **Favorites** — `/like` your current song and view with `/favorites`

### ⏯️ Advanced Playback
- **Seek** — Jump to any timestamp in a song
- **Previous** — Play the previous song (50 song history)
- **Hardware Optimization Engine** — Automatically adapts FFmpeg threads and stream buffers to your host server's specs (RAM/CPU/Disk)
- **Zero-Overhead Direct-to-Disk Stream** — Bypasses Node.js V8 garbage collection completely, drastically improving voice packet latency and preventing audio stutter
- **Opus Priority Protocol** — Explicitly extracts pre-encoded Opus data from YouTube, resulting in perfectly matched Discord bitrate headers with minimal CPU usage
- **24/7 Mode** — Keep the bot in voice channel indefinitely
- **Volume Control** — 0-200% range
- **Vote Skip** — Democratic skipping with configurable ratio based on voice channel members
- **Song in Status** — Show current song as bot activity (Streaming badge for YouTube/Twitch)

### 🎛️ Rich Now Playing
- Progress bar with elapsed/total time
- Requester and platform info
- Loop and autoplay status indicators

## 📁 Project Structure

```
src/
├── index.js                 # Entry point & Seyfert client initialization
├── commands/
│   ├── admin.js             # Server-specific admin commands (/settc, /setvc, /setdjrole, etc.)
│   ├── advanced.js          # /seek, /previous, /replay, /radio
│   ├── favorites.js         # /like, /favorites
│   ├── forceplay.js         # /forceplay
│   ├── lyrics.js            # /lyrics
│   ├── np.js                # /np, /nowplaying (interactive now-playing UI)
│   ├── owner.js             # Bot owner utility & evaluation commands
│   ├── play.js              # /play
│   ├── playback.js          # /pause, /resume
│   ├── playlists.js         # Custom playlists (/savelist, /loadlist, /playlists, etc.)
│   ├── playnext.js          # /playnext
│   ├── queue.js             # /queue
│   ├── queueManagement.js   # /shuffle, /clear, /remove, /move
│   ├── search.js            # /search
│   ├── settings.js          # /settings
│   ├── skip.js              # /skip
│   ├── stop.js              # /stop
│   ├── utility.js           # /help, /ping, /stats
│   └── voteskip.js          # /voteskip
├── services/
│   ├── DatabaseManager.js   # bun:sqlite (WAL mode) and Cloudflare D1 database controller
│   ├── MusicManager.js      # Seyfert-compatible native yt-dlp extractor & stream logic
│   └── serverSettings.js    # Per-server settings with in-memory cache & DB persistence
└── utils/
    ├── cookies.js           # Netscape / JSON cookie file parser
    ├── formatters.js        # Duration formatters
    ├── logger.js            # Console logging module
    └── permissions.js       # DJ/Owner permission check helpers
data/
└── playlists/               # Legacy JSON playlists (auto-migrated to DB on startup)
music_bot.sqlite             # Local SQLite database (favorites, playlists, server settings)
```

## 🚀 Quick Start

### 🐳 Containerized Heroku Deployment (Recommended)
This repository includes a multi-stage `Dockerfile`, `heroku.yml` manifest, and database abstraction layers for deploying the bot to Heroku via Docker in under 5 minutes.
For detailed instructions on configuring Cloudflare D1 and deploying to Heroku, please refer to the [Heroku Deployment Guide](file:///d:/Documents/GitHub/Discord-Music-Bot/heroku-deployment-guide.md).

### Local Installation
To run the bot locally on your machine:

#### Prerequisites

- **Bun** (latest version) - Required for Seyfert
- **FFmpeg** — Required for audio processing
- **yt-dlp** — Required for metadata extraction & YouTube playback
  ```bash
  # Ubuntu/Debian
  sudo apt install ffmpeg
  pip install yt-dlp
  
  # Windows (via chocolatey)
  choco install ffmpeg
  choco install yt-dlp
  
  # Or download yt-dlp directly from https://github.com/yt-dlp/yt-dlp/releases
  ```

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SCUMBAG0LEE/DiscordMusicBot.git
   cd DiscordMusicBot
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

4. **Run the bot**
   ```bash
   bun start
   ```

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in your credentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Discord bot token from [Developer Portal](https://discord.com/developers/applications) |
| `CLIENT_ID` | ✅ | Application (client) ID from Developer Portal |
| `BOT_OWNER_ID` | ✅ | Your Discord user ID (for owner-only commands) |
| `DJ_ROLE_ID` | ❌ | Role ID that can force-skip songs |
| `GUILD_ID` | ❌ | Register commands to a single guild (instant, for testing) |
| `ACTIVITY_TYPE` | ❌ | `PLAYING`, `LISTENING`, `WATCHING`, `COMPETING`, or `STREAMING` (default: `LISTENING`) |
| `ACTIVITY_NAME` | ❌ | Activity text (default: `music \| /help`) |
| `STREAMING_URL` | ❌ | Twitch or YouTube URL — required only if `ACTIVITY_TYPE=STREAMING` |
| `BOT_STATUS` | ❌ | `online`, `idle`, `dnd`, or `invisible` (default: `online`) |
| `SONG_IN_STATUS` | ❌ | Show current song as bot activity (`true`/`false`, default: `false`) |
| `SYSTEM_DISK_TYPE` | ❌ | Optimize buffer chunks based on disk (`auto`, `hdd`, `ssd`, `nvme`) |
| `FFMPEG_THREADS` | ❌ | Max threads allocated to audio transcoding (`auto`, `1`, `2`...) |
| `STREAM_BUFFER_SIZE` | ❌ | Custom buffer size in MB for stream chunks (e.g. `16`) |
| `YTDLP_PATH` | ❌ | Override default `yt-dlp` executable path |
| `FFMPEG_PATH` | ❌ | Override default `ffmpeg` executable path |
| `YOUTUBE_PROXY` | ❌ | Optional HTTP/SOCKS5 proxy URL to route yt-dlp traffic through to bypass hard IP blocks |
| `YOUTUBE_COOKIES` | ❌ | Accepts a file path or a Base64 encoded string of your cookies file (Crucial for Docker/Heroku) |
| `YOUTUBE_USER_AGENT` | ❌ | The exact User-Agent string from the browser used to export your cookies |
| `DJ_ROLE_ID` | ❌ | Role ID that can use DJ-only commands (skip, stop, clear) |
| `SKIP_COMMAND_UPLOAD` | ❌ | Set `true` to skip uploading commands on startup (faster restarts) |

> **Song in Status behavior:** When `SONG_IN_STATUS` is enabled (or toggled per-server with `/songinstatus`), the bot's activity changes dynamically based on what's happening:
> | Scenario | Activity |
> |----------|----------|
> | Playing a YouTube song (1 server) | **Streaming** `Song Name` (purple badge + clickable link) |
> | Playing from other sources (1 server) | **Playing** `Song Name` |
> | Playing in 2+ servers | **Listening to** `music in multiple servers` |
> | Idle / no queues | Reverts to your `.env` configured activity |

### yt-dlp (YouTube Backend)

This bot uses **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** for YouTube support, which is the most reliable method for extracting YouTube audio.

**Benefits:**
- Most reliable YouTube support available
- Regularly updated to handle YouTube changes
- Supports age-restricted content
- Works with live streams and premieres
- Fallback mechanisms for rate limiting

**Setup:**
1. Install yt-dlp: `pip install yt-dlp` or download from [releases](https://github.com/yt-dlp/yt-dlp/releases)
2. Ensure it's in your PATH or place `yt-dlp.exe` in the project root
3. Keep it updated: `pip install -U yt-dlp`

### Discord Bot Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot**
3. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
4. Copy the bot token
5. Go to **OAuth2** → **URL Generator**, select `bot` and `applications.commands` scopes
6. Select permissions: `Connect`, `Speak`, `Send Messages`, `Embed Links`
7. Use the generated URL to invite the bot to your server

## 📋 Commands

### 🎶 Playing Music
| Command | Description |
|---------|-------------|
| `/play <query>` | Play from YouTube/Spotify/SoundCloud/Bandcamp/Vimeo URL or search |
| `/search <query> [platform]` | Interactive search with selection (YouTube or SoundCloud) |
| `/radio <preset\|url>` | Play radio stream (see presets below) |

### ⏯️ Playback Control
| Command | Description |
|---------|-------------|
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and disconnect |
| `/volume <0-200>` | Set playback volume (%) |
| `/seek <timestamp>` | Jump to position (e.g., `1:30`, `90`) |
| `/replay` | Restart current song |
| `/previous` | Play the previous song |

### ⏭️ Skipping
| Command | Description |
|---------|-------------|
| `/skip` | Force skip (DJ/requester only) |
| `/voteskip` | Vote to skip current song |
| `/jump <position>` | Jump to song at queue position |
| `/skipto <position>` | Alias for /jump |

### 📋 Queue Management
| Command | Description |
|---------|-------------|
| `/queue [page]` | View the current queue |
| `/nowplaying` | Rich now playing embed with progress |
| `/np` | Quick now playing info |
| `/shuffle` | Shuffle the queue |
| `/clear` | Clear queue (DJ only) |
| `/remove <position>` | Remove song at position |
| `/move <from> <to>` | Move song in queue |

### 💾 Playlists
| Command | Description |
|---------|-------------|
| `/savelist <name>` | Save current queue as playlist |
| `/loadlist <name>` | Load and play a saved playlist |
| `/playlists` | View your saved playlists |
| `/appendlist <name>` | Add current queue to playlist |
| `/deletelist <name>` | Delete a saved playlist |

### ⚙️ Settings
| Command | Description |
|---------|-------------|
| `/settings` | View or change music settings |
| `/loop` | Cycle loop mode (off → song → queue) |
| `/autoplay` | Toggle autoplay (queue related songs) |
| `/247` | Toggle 24/7 mode (stay in channel) |

### 🔧 Admin (Requires Admin Permission)
| Command | Description |
|---------|-------------|
| `/settc <channel>` | Lock bot to specific text channel |
| `/setvc <channel>` | Lock bot to specific voice channel |
| `/setdjrole <role>` | Set the DJ role |
| `/queuetype` | Set linear or fair queue mode |
| `/skipratio <0.0-1.0>` | Set vote skip threshold |
| `/maxduration <seconds>` | Set maximum song duration |
| `/songinstatus` | Show current song in bot status |
| `/serversettings` | View all server settings |
| `/forceremove` | Force remove songs from queue |

### 🔧 Utility
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/ping` | Check bot latency |
| `/debug` | Show bot stats and music player diagnostics |
| `/lyrics` | Get song lyrics |

### 👑 Owner (Bot Owner Only)
| Command | Description |
|---------|-------------|
| `/setavatar <image>` | Change bot avatar |
| `/setbanner <image>` | Change bot banner |
| `/setname <name>` | Change bot username |
| `/setstatus <status>` | Set bot status (online/idle/dnd/invisible) |
| `/setgame <activity>` | Set bot activity (Playing/Listening/Watching/Competing/Streaming) |
| `/shutdown` | Shut down the bot |
| `/systeminfo` | Show host server diagnostics |
| `/eval <code>` | Evaluate JavaScript (⚠️ dangerous) |
| `/servers` | List all servers the bot is in |
| `/leaveserver <id>` | Leave a server |

## 📻 Radio Presets

Use `/radio <preset>` with these built-in stations:

| Preset | Genre |
|--------|-------|
| `lofi` | Lo-Fi hip hop beats |
| `jazz` | Jazz radio |
| `classical` | Classical music |
| `chillhop` | Chillhop music |
| `synthwave` | Synthwave/retrowave |
| `rock` | Rock radio |
| `electronic` | Electronic/Techno |
| `ambient` | Ambient chill |
| `hiphop` | Hip hop radio |

Or provide any direct stream URL: `/play https://stream.example.com/radio.mp3`


## 🛠️ Development

```bash
# Run with auto-reload
bun run dev
```

## 📜 Version History

- **v5.3.0** — Core Engine Rewrite: Added Hardware Optimization Engine, Direct-to-Disk stream routing, Native Opus Priority Protocol, removed legacy soxr upsampler for massive CPU gains, and unified FFmpeg fallback processes.
- **v5.2.0** — Inactivity warnings & voice validation: Created global voice channel connection validator, protected all commands against outside interference, added empty voice channel disconnect messages, idle queue timeout alerts, and fixed voteskip listener count bug
- **v5.1.0** — Audio quality & reliability: sodium-native for Opus encryption, SoundCloud routed through yt-dlp (fixed premature stream close), disconnect/reconnect race condition fix, auto-playlist infinite loop guard, song-in-status with Streaming badge, FFmpeg reconnect & CRLF headers, Dailymotion support, 5 full code audits with 20+ bug fixes
- **v5.0.0** — Major refactor: Added server settings, admin commands, lyrics, DJ role per-server, fair queue, vote skip ratio, max duration, and more
- **v4.3.0** — Switched to yt-dlp for reliable YouTube playback
- **v4.2.0** — Switched to custom yt-dlp plugin for better YouTube compatibility
- **v4.1.0** — Added audio filters, previous song, skipto command, more radio stations, improved queue display
- **v4.0.0** — DisTube migration (actively maintained), improved YouTube reliability
- **v3.0.0** — Multi-platform support (SoundCloud, Radio), saved playlists, autoplay, 24/7 mode, seek, replay
- **v2.0.0** — Modular architecture, play-dl migration
- **v1.0.0** — Initial release

## 🔧 Troubleshooting

### YouTube playback issues ("Sign in to confirm you're not a bot" / "Requested format is not available")
- **The Twin-Engine Bypass (Required for Server/Cloud hosts):** If you are running the bot on an Ubuntu server or cloud provider, YouTube will aggressively block your datacenter IP. You must use both a PO Token Plugin and a Frozen Cookie file to bypass this blockwall.
  1. **Install the Plugin:** Run `pip install yt-dlp-getpot-wpc` in the exact same Python environment where your `yt-dlp` binary is located. This plugin invisibly opens a headless browser to solve YouTube's cryptographic PoW challenges on the fly.
  2. **The "Frozen" Cookie Trick:** Open a brand new Incognito window in your desktop browser, log into YouTube (preferably using a throwaway account), and *immediately* export the cookies in **Netscape/Mozilla format** before clicking on any videos. Close the window immediately to "freeze" the session and prevent token rotation.
  3. **Load the Cookies:** Save the exported file as `cookies.txt` or `youtube-cookies.txt` in the bot's root directory. Alternatively, provide a Base64 string of the file to the `YOUTUBE_COOKIES` environment variable.
  4. **Match the User-Agent:** Find the exact User-Agent string of the browser you used to export the cookies (search "what is my user agent" on Google). Set this string to the `YOUTUBE_USER_AGENT` environment variable to ensure YouTube doesn't block the request for having mismatched fingerprints.
- **Using a Proxy (For Hard IP Blocks):** Even with cookies and tokens, YouTube may outright ban your server's IP address at the TCP level. If this happens:
  1. Obtain a custom HTTP, HTTPS, or SOCKS5 proxy (e.g. from a residential proxy provider).
  2. Set the `YOUTUBE_PROXY` environment variable to your proxy URL (e.g., `socks5://username:password@ip:port`). All yt-dlp requests will automatically route through it.
  3. **Note on SOCKS5 proxies:** FFmpeg cannot natively route traffic through SOCKS proxies. When a SOCKS5 proxy is detected, the bot automatically switches to download-to-file mode (yt-dlp downloads through the proxy, then FFmpeg reads the local file). HTTP/HTTPS proxies support both direct streaming and download modes.
- Ensure yt-dlp is installed and up-to-date: `pip install -U yt-dlp`
- If region-restricted: yt-dlp's `--geo-bypass` is enabled by default
- Ensure FFmpeg is properly installed: `ffmpeg -version`

### Bot won't connect to voice
- Ensure the bot has `Connect` and `Speak` permissions
- Check that no other bot is using the voice channel exclusively
- If using `/setvc`, make sure the bot is allowed in that channel

### Commands not showing
- Run `/refreshcommands` (owner only) or restart the bot
- Ensure you invited the bot with `applications.commands` scope
- Wait a few minutes for Discord to propagate changes

### Permission issues
- `/setdjrole` to configure who can use DJ commands
- Administrators always have DJ permissions
- Song requesters can skip their own songs

## 📄 License

[MIT](LICENSE)
