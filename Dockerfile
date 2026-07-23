# --- Stage 1: Build stage ---
FROM oven/bun:latest AS builder
WORKDIR /app

# Install compile/build tools for compiling native dependencies (e.g. @discordjs/opus, sodium-native)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package configuration files (bun.lock is optional to handle .gitignore)
COPY package.json bun.loc[k] ./

# Install dependencies, compiling native modules
RUN if [ -f bun.lock ]; then bun install --frozen-lockfile; else bun install; fi

# --- Stage 2: Runtime stage ---
FROM oven/bun:latest AS runner
WORKDIR /app

# Install runtime dependencies: Python3, pip, Chromium (for getpot plugin), and curl
RUN apt-get update && apt-get install -y \
    python3-minimal \
    python3-pip \
    chromium \
    ca-certificates \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the latest static FFmpeg and FFprobe binaries
COPY --from=mwader/static-ffmpeg:latest /ffmpeg /usr/local/bin/ffmpeg
COPY --from=mwader/static-ffmpeg:latest /ffprobe /usr/local/bin/ffprobe
RUN chmod a+rx /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Install the latest release of yt-dlp and the PoW token plugin natively via pip
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp yt-dlp-getpot-wpc

# Copy node modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the rest of the application files
COPY . .

# Ensure orchestration script is executable
RUN chmod +x entrypoint.sh

# Create a non-root user for security best practice
RUN groupadd -r botuser && useradd -r -g botuser -d /app botuser \
    && chown -R botuser:botuser /app
USER botuser

# Set environment variables
ENV NODE_ENV=production

# Healthcheck: verify the bun process is alive (useful for Docker orchestrators like Compose/Swarm)
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -x bun > /dev/null || exit 1

# Start the bot via orchestration script
ENTRYPOINT ["./entrypoint.sh"]
