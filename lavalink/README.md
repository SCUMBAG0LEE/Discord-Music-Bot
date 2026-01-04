# Lavalink Server

This folder contains the Lavalink server configuration.

## Setup

1. **Download Lavalink.jar**
   - Get the latest release from: https://github.com/lavalink-devs/Lavalink/releases
   - Place `Lavalink.jar` in this folder

2. **Run Lavalink**
   ```bash
   java -jar Lavalink.jar
   ```

## Configuration

The `application.yml` file is pre-configured with:

- **YouTube Plugin** - Handles YouTube playback with client rotation
- **LavaSrc** - Spotify support (requires credentials in .env)
- **SponsorBlock** - Auto-skips sponsors in YouTube videos

### Environment Variables

You can customize settings using environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `LAVALINK_PORT` | 2333 | Server port |
| `LAVALINK_ADDRESS` | 0.0.0.0 | Bind address |
| `LAVALINK_PASSWORD` | youshallnotpass | Server password |
| `SPOTIFY_CLIENT_ID` | - | Spotify API client ID |
| `SPOTIFY_CLIENT_SECRET` | - | Spotify API client secret |

### Plugins

Plugins are automatically downloaded on first run. The `+` version syntax means "latest stable":

```yaml
plugins:
  - dependency: "dev.lavalink.youtube:youtube-plugin:+"
```

## Troubleshooting

### YouTube Issues
If YouTube playback fails:
1. Check Lavalink console for errors
2. Try rotating clients in `application.yml`
3. Consider using PO Token if blocked (see comments in config)

### Port Already in Use
Change `LAVALINK_PORT` or kill the existing process:
```bash
# Windows
netstat -ano | findstr :2333
taskkill /PID <pid> /F

# Linux
lsof -i :2333
kill -9 <pid>
```

## Files

- `application.yml` - Lavalink configuration
- `Lavalink.jar` - Server binary (download separately)
- `logs/` - Log files (created on first run)
- `plugins/` - Downloaded plugins (created on first run)
