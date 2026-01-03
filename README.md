# Discord Music Bot - Python + Lavalink

A high-performance Discord music bot built with Python, wavelink, and Lavalink v4.

## Features

- 🎵 **Multi-source support**: YouTube, Spotify, SoundCloud, and 900+ sites via Lavalink
- ⚡ **High performance**: Audio processing offloaded to Lavalink server
- 🎛️ **Audio filters**: Bass boost, nightcore, 8D audio, equalizer presets, and more
- 📋 **Queue management**: Shuffle, clear, move, jump, loop modes
- 💾 **Personal playlists**: Save and load your favorite queues
- 🗳️ **Vote skip**: Democratic skipping system
- 📻 **Autoplay**: Automatically queue related songs

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Discord Bot    │────▶│   Lavalink      │
│  (Python)       │◀────│   (Java)        │
│  - Commands     │     │  - Audio decode │
│  - Queue logic  │     │  - Streaming    │
│  - User input   │     │  - Filters      │
└─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
   Discord API            YouTube/Spotify/etc
```

## Requirements

- Python 3.10+
- Java 17+ (for Lavalink)
- A Discord Bot Token

## Setup

### Quick Start (Windows)

```batch
# 1. Download Lavalink
python scripts/download_lavalink.py

# 2. Configure .env
copy .env.example .env
# Edit .env with your BOT_TOKEN

# 3. Start Lavalink (in one terminal)
start_lavalink.bat

# 4. Start Bot (in another terminal)
start_bot.bat
```

### Manual Setup

#### 1. Install Lavalink

Download Lavalink.jar from [GitHub Releases](https://github.com/lavalink-devs/Lavalink/releases).

```bash
# Or use the helper script
python scripts/download_lavalink.py
```

#### 2. Start Lavalink

```bash
cd lavalink
java -jar Lavalink.jar
```

Lavalink will automatically download the configured plugins on first start.

#### 3. Setup Python Bot

```bash
# Create virtual environment
python -m venv venv

# Activate it
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

#### 4. Configure Environment

```bash
# Copy example env
cp .env.example .env

# Edit .env with your values
```

Required environment variables:
- `BOT_TOKEN` - Your Discord bot token
- `LAVALINK_URI` - Lavalink server URI (default: http://localhost:2333)
- `LAVALINK_PASSWORD` - Lavalink password (default: youshallnotpass)

### 5. Run the Bot

```bash
python bot.py
```

## Commands

### Playing Music
| Command | Description |
|---------|-------------|
| `/play <query>` | Play from URL or search |
| `/pause` | Pause playback |
| `/resume` | Resume playback |
| `/stop` | Stop and disconnect |
| `/skip` | Skip current track |
| `/voteskip` | Vote to skip |
| `/previous` | Play previous track |
| `/seek <time>` | Seek to timestamp |
| `/replay` | Restart current track |

### Queue Management
| Command | Description |
|---------|-------------|
| `/queue` | View the queue |
| `/nowplaying` | Current track with progress |
| `/shuffle` | Shuffle the queue |
| `/clear` | Clear the queue |
| `/remove <pos>` | Remove a track |
| `/move <from> <to>` | Move a track |
| `/jump <pos>` | Jump to a track |
| `/loop` | Toggle loop mode |
| `/autoplay` | Toggle autoplay |

### Audio Filters
| Command | Description |
|---------|-------------|
| `/filters <filter>` | Apply audio filter |
| `/equalizer <preset>` | EQ presets |
| `/volume <0-200>` | Set volume |
| `/speed <0.5-2.0>` | Playback speed |
| `/pitch <0.5-2.0>` | Audio pitch |

Available filters: bassboost, nightcore, vaporwave, karaoke, 8d, treble, slow, fast, lofi, vibrato, loud

### Playlists
| Command | Description |
|---------|-------------|
| `/savelist <name>` | Save queue as playlist |
| `/loadlist <name>` | Load a playlist |
| `/playlists` | List your playlists |
| `/deletelist <name>` | Delete a playlist |
| `/appendlist <name>` | Add queue to playlist |

## Lavalink Plugins

This setup includes:

- **youtube-plugin** - YouTube support with anti-bot bypass
- **LavaSrc** - Spotify, Apple Music, Deezer integration
- **SponsorBlock** - Auto-skip sponsors in YouTube videos

Configure them in `lavalink/application.yml`.

## Performance Notes

- Lavalink handles all audio processing, the Python bot just sends commands
- Can scale to hundreds of servers per Lavalink node
- Multiple Lavalink nodes supported for redundancy
- Memory usage: ~50-100MB for bot, ~200-400MB for Lavalink per server

## Troubleshooting

### Lavalink won't start
- Ensure Java 17+ is installed: `java -version`
- Check port 2333 is available

### YouTube not working
- Update youtube-plugin in application.yml to latest version
- Check Lavalink logs for errors

### Spotify not working
- Add your Spotify API credentials in application.yml
- Ensure LavaSrc plugin is configured

## License

MIT
