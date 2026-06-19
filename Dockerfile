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

# Install runtime dependencies: Python3 (needed by yt-dlp) and curl (to fetch yt-dlp)
RUN apt-get update && apt-get install -y \
    python3-minimal \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy the latest static FFmpeg and FFprobe binaries
COPY --from=mwader/static-ffmpeg:latest /ffmpeg /usr/local/bin/
COPY --from=mwader/static-ffmpeg:latest /ffprobe /usr/local/bin/

# Install the latest release of yt-dlp from official GitHub Releases
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Copy node modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the rest of the application files
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Start the bot
CMD ["bun", "src/index.js"]
