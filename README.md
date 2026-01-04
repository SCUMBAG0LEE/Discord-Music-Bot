# 🎵 Discord Music Bot

A feature-rich Discord music bot powered by **Lavalink** — inspired by [JMusicBot](https://github.com/jagrosh/MusicBot) but using modern JavaScript and Lavalink architecture.

## ✨ Features

### 🎶 Multi-Platform Support
- **YouTube** — Songs, playlists, and search
- **Spotify** — Tracks, playlists, and albums (via LavaSrc plugin)
- **SoundCloud** — Tracks and playlists

### 📋 Queue Management
- Paginated queue display
- Shuffle, move, remove, and jump
- **Loop Mode** — Off, track, or queue
- **Fair Queue** — Round-robin mode to prevent queue domination
- **Max Queue Size** — Configurable limit (0 = unlimited)
- **Max Duration** — Reject tracks over a time limit

### ⏯️ Playback Controls
- **Seek** — Jump to any timestamp
- **Replay** — Restart the current song
- **Previous** — Play the previous song
- **Volume Control** — 0-150% range
- **Audio Filters** — Bass boost, nightcore, vaporwave, 8D, and more
- **Vote Skip** — Configurable skip ratio per server

### 🎛️ Rich Now Playing
- Progress bar with elapsed/total time
- Requester info
- Loop status indicators
- **Lyrics** — Fetch song lyrics automatically

### 🔒 Permission System
- **DJ Role** — Control who can force skip, clear queue, etc.
- **Owner Commands** — Bot owner exclusives (setavatar, shutdown, etc.)
- **Vote Skip** — Non-DJs can vote to skip

### 💾 Playlists
- **Save/Load** — Save queue as personal playlist
- **Append** — Add tracks to existing playlists
- **Auto-Playlist** — Auto-load a playlist when bot joins

### ⚙️ Server Settings
- **Channel Lock** — Restrict bot to specific text/voice channels
- **24/7 Mode** — Keep bot in voice channel permanently
- **Song in Status** — Show current track in bot's activity
- **Per-Server Config** — Each server can have custom settings

## 📁 Project Structure

```
src/
├── index.js                 # Entry point, Lavalink/Kazagumo setup
├── commands/
│   ├── play.js              # /play - Multi-platform playback
│   ├── playback.js          # /pause, /resume, /stop, /skip, /volume, /loop, /seek, /nowplaying, /replay, /previous
│   ├── queue.js             # /queue - Paginated queue display
│   ├── queueManagement.js   # /shuffle, /clear, /remove, /move, /jump, /skipto
│   ├── filters.js           # /filter, /clearfilter, /filters, /speed, /pitch
│   ├── search.js            # /search - Interactive search with selection
│   ├── settings.js          # /settings, /forceskip, /voteskip, /forceplay, /playnext
│   ├── playlists.js         # /savelist, /loadlist, /deletelist, /playlists, /appendlist
│   ├── admin.js             # /settc, /setvc, /queuetype, /skipratio, /autoplaylist, /songinstatus
│   ├── owner.js             # /setavatar, /setname, /setstatus, /setgame, /shutdown, /debug
│   ├── lyrics.js            # /lyrics - Fetch song lyrics
│   └── utility.js           # /help, /ping, /stats
├── services/
│   ├── playlists.js         # File-based playlist storage
│   └── serverSettings.js    # Per-server settings storage
└── utils/
    ├── formatters.js        # Duration formatting utilities
    ├── permissions.js       # DJ/Owner permission checks
    └── logger.js            # Colored console logging
lavalink/
└── application.yml          # Lavalink server configuration
data/
├── playlists/               # User playlists (auto-created)
└── servers/                 # Server settings (auto-created)
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+**
- **Java 17+** — Required for Lavalink server
- **Lavalink Server** — See setup below

### Lavalink Server Setup

1. **Download Lavalink**
   ```bash
   # Download from https://github.com/lavalink-devs/Lavalink/releases
   # Get the latest Lavalink.jar
   ```

2. **Create application.yml** (or use the one in `lavalink/` folder)
   ```yaml
   server:
     port: 2333
     address: 0.0.0.0
   
   lavalink:
     server:
       password: "youshallnotpass"
       sources:
         youtube: false  # Using plugin instead
         spotify: true
         soundcloud: true
   
   plugins:
     - dependency: "dev.lavalink.youtube:youtube-plugin:+"
       snapshot: false
   ```

3. **Run Lavalink**
   ```bash
   java -jar Lavalink.jar
   ```

### Bot Installation

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

4. **Run the bot** (make sure Lavalink is running first!)
   ```bash
   npm start
   ```

## ⚙️ Configuration

Copy `.env.example` to `.env` and fill in your credentials:

| Variable | Required | Description |
|----------|----------|-------------|
| `BOT_TOKEN` | ✅ | Discord bot token |
| `CLIENT_ID` | ✅ | Bot application ID (for slash commands) |
| `GUILD_ID` | ❌ | Test server ID (instant command updates) |
| `OWNER_ID` | ❌ | Your Discord user ID (for owner commands) |
| `DJ_ROLE_ID` | ❌ | Role ID for DJ permissions |
| `LAVALINK_HOST` | ✅ | Lavalink server address (e.g., `localhost:2333`) |
| `LAVALINK_PASSWORD` | ✅ | Lavalink server password |
| `LAVALINK_SECURE` | ❌ | Use WSS/HTTPS (default: false) |
| `DEFAULT_VOLUME` | ❌ | Default volume (0-150, default: 100) |
| `MAX_QUEUE_SIZE` | ❌ | Max queue length (0 = unlimited) |
| `MAX_DURATION` | ❌ | Max track duration in seconds (0 = unlimited) |
| `SKIP_RATIO` | ❌ | Vote skip ratio (0.0-1.0, default: 0.5) |
| `ALONE_TIME` | ❌ | Seconds before leaving empty VC (default: 60) |
| `IDLE_TIME` | ❌ | Seconds before leaving when idle (default: 120) |
| `STAY_IN_CHANNEL` | ❌ | Global 24/7 mode (default: false) |
| `BOT_ACTIVITY_TYPE` | ❌ | Activity type: PLAYING, LISTENING, WATCHING, COMPETING |
| `BOT_ACTIVITY_NAME` | ❌ | Activity text (default: music \| /help) |
| `BOT_STATUS` | ❌ | Status: online, idle, dnd, invisible |

### Discord Bot Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot**
3. Copy the bot token
4. Go to **OAuth2** → **URL Generator**, select `bot` and `applications.commands` scopes
5. Select permissions: `Connect`, `Speak`, `Send Messages`, `Embed Links`
6. Use the generated URL to invite the bot to your server

## 📋 Commands

### 🎶 Playing Music
| Command | Description |
|---------|-------------|
| `/play <query>` | Play from YouTube/Spotify/SoundCloud URL or search |
| `/search <query>` | Search and select from results |
| `/playnext <query>` | Add song to play next in queue |
| `/forceplay <query>` | Play immediately, skipping current (DJ) |

### ⏯️ Playback Control
| Command | Description |
|---------|-------------|
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and disconnect |
| `/volume <0-150>` | Set playback volume (%) |
| `/seek <timestamp>` | Jump to position (e.g., `1:30`, `90`) |
| `/replay` | Restart current song |
| `/previous` | Play the previous song |
| `/nowplaying` | Show now playing info |
| `/loop` | Cycle loop mode (off → track → queue) |
| `/lyrics [query]` | Get song lyrics |

### ⏭️ Skipping
| Command | Description |
|---------|-------------|
| `/skip` | Skip current track (vote or force) |
| `/forceskip` | Force skip (DJ only) |
| `/voteskip` | Vote to skip |
| `/jump <position>` | Jump to song at queue position |
| `/skipto <position>` | Alias for /jump |

### 📋 Queue Management
| Command | Description |
|---------|-------------|
| `/queue [page]` | View the current queue |
| `/shuffle` | Shuffle the queue |
| `/clear` | Clear queue |
| `/remove <position>` | Remove song at position |
| `/forceremove` | Force remove by position or user (DJ) |
| `/move <from> <to>` | Move song in queue |

### 💾 Playlists
| Command | Description |
|---------|-------------|
| `/playlists` | View your saved playlists |
| `/savelist <name>` | Save current queue as playlist |
| `/loadlist <name>` | Load and play a playlist |
| `/appendlist <name>` | Add current queue to playlist |
| `/deletelist <name>` | Delete a playlist |

### 🎛️ Audio Filters
| Command | Description |
|---------|-------------|
| `/filter <preset>` | Apply audio filter |
| `/clearfilter` | Remove all filters |
| `/filters` | Show available filters |
| `/speed <0.5-2.0>` | Adjust playback speed |
| `/pitch <0.5-2.0>` | Adjust audio pitch |

**Available Filter Presets:**
`bassboost`, `nightcore`, `vaporwave`, `8d`, `tremolo`, `vibrato`, `karaoke`, `lowpass`, `soft`, `trebleboost`

### ⚙️ Settings
| Command | Description |
|---------|-------------|
| `/settings view` | View current settings |
| `/settings volume <level>` | Set default volume |
| `/settings djrole [role]` | Set/clear DJ role |
| `/settings 247` | Toggle 24/7 mode for this server |
| `/serversettings` | View all server settings |

### 🔧 Admin Commands (Requires Administrator)
| Command | Description |
|---------|-------------|
| `/settc [channel]` | Lock bot to a text channel |
| `/setvc [channel]` | Lock bot to a voice channel |
| `/queuetype <linear\|fair>` | Set queue type (fair = round-robin) |
| `/skipratio [ratio]` | Set vote skip ratio for server |
| `/autoplaylist [name]` | Set auto-load playlist |
| `/songinstatus` | Toggle showing song in bot status |

### 👑 Owner Commands
| Command | Description |
|---------|-------------|
| `/setavatar <image>` | Change bot avatar |
| `/setname <name>` | Change bot username |
| `/setstatus <status>` | Change online status |
| `/setgame <type> [text]` | Change activity |
| `/shutdown` | Shutdown the bot |
| `/debug` | Show debug information |

### 🔧 Utility
| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/ping` | Check bot and Lavalink latency |
| `/stats` | Bot statistics |

## 🔧 Lavalink Plugins

The bot works best with these Lavalink plugins (configured in `application.yml`):

| Plugin | Purpose |
|--------|---------|
| `youtube-plugin` | YouTube support (handles blocks/rate limits) |
| `LavaSrc` | Spotify, Apple Music, Deezer support |
| `SponsorBlock` | Auto-skip sponsors in YouTube videos |

## 🛠️ Development

```bash
# Run with auto-reload
npm run dev
```

## 📜 Version History

- **v5.0.0** — Complete rewrite with Lavalink/Kazagumo (replaced DisTube)
- **v4.x.x** — DisTube + YouTube.js version (legacy)
- **v3.0.0** — Multi-platform support, saved playlists
- **v2.0.0** — Modular architecture
- **v1.0.0** — Initial release

## 🔧 Troubleshooting

### YouTube playback issues
- Ensure Lavalink's `youtube-plugin` is properly configured
- Try updating to the latest plugin version (use `+` in `application.yml`)
- Check Lavalink console for errors

### Bot won't connect to voice
- Ensure the bot has `Connect` and `Speak` permissions
- Check that Lavalink server is running and accessible

### Commands not showing
- Wait up to 1 hour for global commands, or use `GUILD_ID` for instant updates
- Ensure you invited the bot with `applications.commands` scope

### Lavalink connection issues
- Verify `LAVALINK_HOST` and `LAVALINK_PASSWORD` in `.env`
- Ensure Lavalink server is running before starting the bot
- Check firewall settings if using remote Lavalink

## 📄 License

[MIT](LICENSE)
