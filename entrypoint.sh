#!/bin/bash
set -e

if [ "$ENABLE_WARP_PROXY" = "true" ]; then
    echo "🤖 Starting warp-plus (Cloudflare WARP User-Space Proxy)..."
    # Boot the lightweight daemon in the background and log its output
    # We use --scan to automatically find an unblocked Cloudflare IP, and -4 to prevent IPv6 crashes
    warp-plus -4 --scan > warp.log 2>&1 &
    # Wait for the daemon to initialize its socket and establish the Psiphon tunnel
    echo "⏳ Waiting 15 seconds for Psiphon tunnel to establish..."
    sleep 15
    cat warp.log

    echo "🚀 Launching Discord Bot with WARP Proxy..."
    # Only route yt-dlp through WARP via SOCKS5 (warp-plus default is 8086)
    export YOUTUBE_PROXY="socks5://127.0.0.1:8086"
else
    echo "🚀 Launching Discord Bot (WARP Proxy Disabled)..."
fi

exec bun src/index.js
