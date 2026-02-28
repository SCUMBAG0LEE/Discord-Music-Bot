# 🎵 Discord Music Bot

A feature-rich Discord music bot with **YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, Twitch, and Radio** support, built with discord.js v14 and [DisTube](https://distube.js.org/) using **yt-dlp** for reliable playback.

## ✨ Features

### 🎶 Multi-Platform Support
- **YouTube** — Songs, playlists, and interactive search (via yt-dlp)
- **Spotify** — Tracks, playlists, and albums (auto-converts to YouTube)
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

### 💾 Saved Playlists
- Save current queue as a reusable playlist
- Load, append, and delete your playlists
- Server-specific playlist storage

### ⏯️ Advanced Playback
- **Seek** — Jump to any timestamp in a song
- **Replay** — Restart the current song instantly
- **Previous** — Play the previous song
- **24/7 Mode** — Keep the bot in voice channel indefinitely
- **Volume Control** — 0-200% range
- **Vote Skip** — Democratic skipping with configurable ratio
- **Audio Filters** — Bass boost, nightcore, vaporwave, and more
- **Lyrics** — Fetch song lyrics automatically

### 🎛️ Rich Now Playing
- Progress bar with elapsed/total time
- Requester and platform info
- Loop and autoplay status indicators

## 📁 Project Structure

```
src/
├── index.js                 # Entry point & command loader
├── commands/
│   ├── play.js              # /play - Multi-platform playback
│   ├── search.js            # /search - Interactive YouTube/SoundCloud search
│   ├── queue.js             # /queue - Paginated queue display
│   ├── playback.js          # /pause, /resume, /stop, /volume, /skip, /np, /previous
│   ├── queueManagement.js   # /shuffle, /clear, /remove, /move, /jump, /skipto
│   ├── playlists.js         # /savelist, /loadlist, /deletelist, /playlists, /appendlist
│   ├── advanced.js          # /seek, /replay, /nowplaying, /radio
│   ├── settings.js          # /settings, /forceskip, /voteskip, /forceplay, /playnext, /loop, /autoplay, /247
│   ├── filters.js           # /filter, /clearfilter, /filters
│   ├── admin.js             # /settc, /setvc, /queuetype, /skipratio, /autoplaylist, /songinstatus, /serversettings, /maxduration, /setdjrole, /forceremove
│   ├── owner.js             # /setavatar, /setname, /setstatus, /setgame, /shutdown, /debug, /eval, /servers, /leaveserver
│   ├── lyrics.js            # /lyrics - Fetch song lyrics
│   └── utility.js           # /help, /refreshcommands, /ping, /stats
├── plugins/
│   └── YtDlpPlugin.js       # Custom DisTube plugin using yt-dlp
├── services/
│   ├── distube.js           # DisTube initialization & event handling
│   ├── playlists.js         # File-based playlist storage
│   └── serverSettings.js    # Per-server configuration storage
└── utils/
    ├── formatters.js        # Duration formatting utilities
    ├── permissions.js       # DJ/owner permission checks
    └── logger.js            # Colored console logging
data/
├── playlists/               # User playlists (auto-created)
└── servers/                 # Server settings (auto-created)
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** — Required for DisTube and discord.js v14
- **FFmpeg** — Required for audio processing
- **yt-dlp** — Required for YouTube playback
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
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your tokens
   ```

4. **Run the bot**
   ```bash
   npm start
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
| `SPOTIFY_CLIENT_ID` | ⚠️ | From [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `SPOTIFY_CLIENT_SECRET` | ⚠️ | From Spotify Developer Dashboard |
| `ACTIVITY_TYPE` | ❌ | `PLAYING`, `LISTENING`, `WATCHING`, `COMPETING`, or `STREAMING` (default: `LISTENING`) |
| `ACTIVITY_NAME` | ❌ | Activity text (default: `music \| /help`) |
| `STREAMING_URL` | ❌ | Twitch or YouTube URL — required only if `ACTIVITY_TYPE=STREAMING` |
| `BOT_STATUS` | ❌ | `online`, `idle`, `dnd`, or `invisible` (default: `online`) |
| `SONG_IN_STATUS` | ❌ | Show current song as bot activity (`true`/`false`, default: `false`) |

> **Song in Status behavior:** When `SONG_IN_STATUS` is enabled (or toggled per-server with `/songinstatus`), the bot's activity changes dynamically based on what's happening:
> | Scenario | Activity |
> |----------|----------|
> | Playing a YouTube song (1 server) | **Streaming** `Song Name` (purple badge + clickable link) |
> | Playing from other sources (1 server) | **Playing** `Song Name` |
> | Playing in 2+ servers | **Listening to** `music in multiple servers` |
> | Idle / no queues | Reverts to your `.env` configured activity |

> ⚠️ Spotify credentials are required only if you want Spotify support. The bot works fine with just YouTube.

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
| `/filters <filter>` | Apply audio filters |

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
| `/autoplaylist <name>` | Auto-play a playlist when queue ends |
| `/songinstatus` | Show current song in bot status |
| `/serversettings` | View all server settings |
| `/forceremove` | Force remove songs from queue |

### 🔧 Utility
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/ping` | Check bot latency |
| `/stats` | Bot statistics |
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
| `/debug` | Show bot debug info |
| `/eval <code>` | Evaluate JavaScript (⚠️ dangerous) |
| `/servers` | List all servers the bot is in |
| `/leaveserver <id>` | Leave a server |
| `/refreshcommands` | Refresh slash commands |

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

## 🎛️ Audio Filters

Use `/filters <filter>` to toggle audio effects:

| Filter | Effect |
|--------|--------|
| `bassboost` | Enhanced bass |
| `nightcore` | Sped up + higher pitch |
| `vaporwave` | Slowed down + lower pitch |
| `3d` | 3D spatial audio |
| `tremolo` | Wavering volume effect |
| `vibrato` | Wavering pitch effect |
| `karaoke` | Remove vocals |
| `treble` | Enhanced treble |
| `subboost` | Enhanced sub-bass |
| `phaser` | Phaser sweep effect |

Additional filters available via `/filter`: `reverse`, `normalizer`, `surrounding`, `pulsator`, `flanger`, `gate`, `haas`, `mcompand`, `earwax`.
Use `/clearfilter` to remove all active filters.

## 🛠️ Development

```bash
# Run with auto-reload (Node 18+)
npm run dev
```

## 📜 Version History

- **v5.0.0** — Major refactor: Added server settings, admin commands, lyrics, DJ role per-server, fair queue, vote skip ratio, max duration, and more
- **v4.3.0** — Switched to yt-dlp for reliable YouTube playback
- **v4.2.0** — Switched to custom yt-dlp plugin for better YouTube compatibility
- **v4.1.0** — Added audio filters, previous song, skipto command, more radio stations, improved queue display
- **v4.0.0** — DisTube migration (actively maintained), improved YouTube reliability
- **v3.0.0** — Multi-platform support (SoundCloud, Radio), saved playlists, autoplay, 24/7 mode, seek, replay
- **v2.0.0** — Modular architecture, play-dl migration
- **v1.0.0** — Initial release

## 🔧 Troubleshooting

### YouTube playback issues
- Ensure yt-dlp is installed and up-to-date: `pip install -U yt-dlp`
- YouTube may rate-limit requests. Try using cookies:
  1. Export cookies from your browser in **Netscape/Mozilla format** using a browser extension (e.g., [Get cookies.txt](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc))
  2. Save the file as `youtube-cookies.txt` in the project root (or `cookies.txt`)
  3. **JSON format** (e.g. from EditThisCookie) is also accepted — it's converted automatically
  4. Restart the bot — cookies are loaded automatically
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
