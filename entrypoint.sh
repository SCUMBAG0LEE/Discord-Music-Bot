#!/bin/bash
set -e

if [ "$ENABLE_WARP_PROXY" = "true" ]; then
    echo "🤖 Starting Cloudflare WARP Daemon..."
    # Boot the daemon in the background
    warp-svc --accept-tos &

    # Wait briefly for the daemon to initialize its socket
    sleep 3

    echo "🔑 Configuring SOCKS5 Proxy Mode..."
    warp-cli --accept-tos registration new || true
    warp-cli --accept-tos mode proxy
    warp-cli --accept-tos proxy port 8010
    warp-cli --accept-tos connect

    # Give WARP a moment to establish the tunnel
    sleep 2

    echo "🚀 Launching Discord Bot with WARP Proxy..."
    # Only route yt-dlp through WARP via SOCKS5
    export YOUTUBE_PROXY="socks5://127.0.0.1:8010"
else
    echo "🚀 Launching Discord Bot (WARP Proxy Disabled)..."
fi

exec bun src/index.js
