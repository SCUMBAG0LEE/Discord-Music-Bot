# � Discord Music Bot

A feature-rich Discord music bot with YouTube and Spotify support, built with discord.js v14.

## ✨ Features

- **Multi-Platform Support** — Play from YouTube URLs, playlists, and Spotify tracks/albums/playlists
- **Interactive Search** — Search YouTube and pick from results
- **Queue Management** — View, shuffle, clear, remove, move, and jump through songs
- **Playback Controls** — Pause, resume, stop, skip, loop, and volume control
- **Vote Skip** — Democratic skipping with configurable threshold
- **DJ Role** — Restrict force-skip to specific roles
- **Auto-Disconnect** — Leaves voice channel after 1 minute of inactivity

## 📁 Project Structure

```
src/
├── index.js                 # Entry point & command loader
├── commands/
│   ├── play.js              # /play - YouTube/Spotify playback
│   ├── search.js            # /search - Interactive YouTube search
│   ├── queue.js             # /queue - Paginated queue display
│   ├── playback.js          # /pause, /resume, /stop, /volume, /loop, /skip, /voteskip, /np
│   ├── queueManagement.js   # /shuffle, /clear, /remove, /move, /jump
│   └── utility.js           # /help, /refreshcommands
├── services/
│   ├── queueManager.js      # Centralized queue state management
│   ├── player.js            # Audio playback & idle handling
│   ├── spotify.js           # Spotify API integration
│   └── youtube.js           # YouTube/ytdl services
└── utils/
    ├── formatters.js        # Duration formatting utilities
    └── permissions.js       # DJ/owner permission checks
```

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** 
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
| `SPOTIFY_CLIENT_ID` | ✅ | From [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) |
| `SPOTIFY_CLIENT_SECRET` | ✅ | From Spotify Developer Dashboard |

### Discord Bot Setup

1. Create an application at the [Discord Developer Portal](https://discord.com/developers/applications)
2. Go to **Bot** → **Add Bot**
3. Enable **MESSAGE CONTENT INTENT** under Privileged Gateway Intents
4. Copy the bot token
5. Go to **OAuth2** → **URL Generator**, select `bot` and `applications.commands` scopes
6. Select permissions: `Connect`, `Speak`, `Send Messages`, `Embed Links`
7. Use the generated URL to invite the bot to your server

## 📋 Commands

| Command | Description |
|---------|-------------|
| `/play <query>` | Play a YouTube/Spotify URL or search term |
| `/search <query>` | Search YouTube and select from results |
| `/queue` | View the current queue with pagination |
| `/np` | Show now playing info |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and disconnect |
| `/skip` | Force skip (DJ/requester only) |
| `/voteskip` | Vote to skip current song |
| `/volume <0-5>` | Set playback volume |
| `/loop` | Toggle loop mode |
| `/shuffle` | Shuffle the queue |
| `/clear` | Clear queue (keeps current song) |
| `/remove <position>` | Remove song at position |
| `/move <from> <to>` | Move song in queue |
| `/jump <position>` | Jump to song at position |
| `/help` | Show command list |

## 🛠️ Development

```bash
# Run with auto-reload (Node 18+)
npm run dev
```

## 📄 License

[MIT](LICENSE)
