#!/bin/bash
set -e

if [ "$ENABLE_WARP_PROXY" = "true" ]; then
    echo "🤖 Starting warp-plus (Cloudflare WARP User-Space Proxy)..."
    # Boot the lightweight daemon in the background
    warp-plus -bind 127.0.0.1:8010 &

    # Give it a moment to establish the WireGuard tunnel
    sleep 3

    echo "🚀 Launching Discord Bot with WARP Proxy..."
    # Only route yt-dlp through WARP via SOCKS5
    export YOUTUBE_PROXY="socks5://127.0.0.1:8010"
else
    echo "🚀 Launching Discord Bot (WARP Proxy Disabled)..."
fi

exec bun src/index.js
