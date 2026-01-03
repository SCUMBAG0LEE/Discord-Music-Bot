# 🎵 Discord Music Bot

A feature-rich Discord music bot with **YouTube, Spotify, SoundCloud, and Radio** support, built with discord.js v14 and [DisTube](https://distube.js.org/).

## ✨ Features

### 🎶 Multi-Platform Support
- **YouTube** — Songs, playlists, and interactive search
- **Spotify** — Tracks, playlists, and albums (auto-converts to YouTube)
- **SoundCloud** — Tracks and playlists
- **Radio/Streams** — Built-in presets and custom stream URLs

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
- **Vote Skip** — Democratic skipping
- **Audio Filters** — Bass boost, nightcore, vaporwave, and more

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
│   ├── search.js            # /search - Interactive YouTube search
│   ├── queue.js             # /queue - Paginated queue display
│   ├── playback.js          # /pause, /resume, /stop, /volume, /loop, /skip, /voteskip, /np, /previous, /filters
│   ├── queueManagement.js   # /shuffle, /clear, /remove, /move, /jump, /skipto
│   ├── playlists.js         # /savelist, /loadlist, /deletelist, /playlists, /appendlist
│   ├── advanced.js          # /seek, /replay, /nowplaying, /autoplay, /247, /radio
│   └── utility.js           # /help, /refreshcommands
├── services/
│   ├── distube.js           # DisTube initialization & event handling
│   └── playlists.js         # File-based playlist storage
└── utils/
    ├── formatters.js        # Duration formatting utilities
    └── permissions.js       # DJ/owner permission checks
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 22+** — Required for DisTube
- **FFmpeg** — Required for audio processing
  ```bash
  # Ubuntu/Debian
  sudo apt install ffmpeg
  
  # Windows (via chocolatey)
  choco install ffmpeg
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
| `BOT_OWNER_ID` | ✅ | Your Discord user ID (for owner-only commands) |
| `DJ_ROLE_ID` | ❌ | Role ID that can force-skip songs |
| `SPOTIFY_CLIENT_ID` | ⚠️ | From [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `SPOTIFY_CLIENT_SECRET` | ⚠️ | From Spotify Developer Dashboard |

> ⚠️ Spotify credentials are required only if you want Spotify support. The bot works fine with just YouTube.

### YouTube Cookies (Optional)

If you experience YouTube playback issues (age-restricted or rate-limited), you can provide cookies:

1. Install a browser extension like "Get cookies.txt" or "EditThisCookie"
2. Export cookies from youtube.com in JSON format
3. Save as `youtube-cookies.json` in the project root

```json
[
  {
    "name": "cookie_name",
    "value": "cookie_value",
    "domain": ".youtube.com",
    "path": "/",
    "secure": true,
    "httpOnly": true
  }
]
```

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
| `/play <query>` | Play from YouTube/Spotify/SoundCloud URL or search |
| `/search <query>` | Interactive YouTube search with selection |
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
| `/loop` | Cycle loop mode (off → song → queue) |
| `/autoplay` | Toggle autoplay (queue related songs) |
| `/247` | Toggle 24/7 mode (stay in channel) |

### 🔧 Utility
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/refreshcommands` | Refresh slash commands (owner only) |

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
| `echo` | Echo/reverb effect |
| `karaoke` | Remove vocals |
| `surround` | Surround sound |
| `slow` | Slow playback |
| `fast` | Fast playback |
| `clear` | Remove all filters |

## 🛠️ Development

```bash
# Run with auto-reload (Node 18+)
npm run dev
```

## 📜 Version History

- **v4.1.0** — Added audio filters, previous song, skipto command, more radio stations, improved queue display
- **v4.0.0** — DisTube migration (actively maintained), improved YouTube reliability
- **v3.0.0** — Multi-platform support (SoundCloud, Radio), saved playlists, autoplay, 24/7 mode, seek, replay
- **v2.0.0** — Modular architecture, play-dl migration
- **v1.0.0** — Initial release

## 🔧 Troubleshooting

### YouTube playback issues
- YouTube may rate-limit or block requests. Try adding YouTube cookies (see Configuration section)
- Ensure FFmpeg is properly installed: `ffmpeg -version`

### Bot won't connect to voice
- Ensure the bot has `Connect` and `Speak` permissions
- Check that no other bot is using the voice channel exclusively

### Commands not showing
- Run `/refreshcommands` (owner only) or restart the bot
- Ensure you invited the bot with `applications.commands` scope

## 📄 License

[MIT](LICENSE)
