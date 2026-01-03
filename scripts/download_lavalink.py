#!/usr/bin/env python3
"""
Helper script to download Lavalink.jar
Run: python scripts/download_lavalink.py
"""

import urllib.request
import json
import os
import sys

# Use latest release
LAVALINK_URL = "https://github.com/lavalink-devs/Lavalink/releases/latest/download/Lavalink.jar"

def main():
    lavalink_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "lavalink")
    jar_path = os.path.join(lavalink_dir, "Lavalink.jar")
    
    if os.path.exists(jar_path):
        print(f"Lavalink.jar already exists at {jar_path}")
        response = input("Download anyway? (y/n): ").strip().lower()
        if response != 'y':
            return
    
    print(f"Downloading latest Lavalink...")
    print(f"URL: {LAVALINK_URL}")
    
    try:
        # Download with progress
        def progress(count, block_size, total_size):
            percent = int(count * block_size * 100 / total_size)
            sys.stdout.write(f"\rProgress: {percent}%")
            sys.stdout.flush()
        
        urllib.request.urlretrieve(LAVALINK_URL, jar_path, progress)
        print(f"\n✅ Downloaded to {jar_path}")
        print(f"\nTo start Lavalink:")
        print(f"  cd lavalink")
        print(f"  java -jar Lavalink.jar")
        
    except Exception as e:
        print(f"\n❌ Download failed: {e}")
        print(f"\nManual download: {LAVALINK_URL}")
        sys.exit(1)


if __name__ == "__main__":
    main()
