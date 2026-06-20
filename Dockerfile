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

# Install runtime dependencies, Cloudflare WARP client, and yt-dlp requirements
RUN apt-get update && apt-get install -y \
    python3-minimal \
    ca-certificates \
    curl \
    gnupg2 \
    lsb-release \
    && curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg | gpg --yes --dearmor --output /usr/share/keyrings/cloudflare-warp-archive-keyring.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg] https://pkg.cloudflareclient.com/ $(lsb_release -cs) main" | tee /etc/apt/sources.list.d/cloudflare-client.list \
    && apt-get update && apt-get install -y cloudflare-warp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy the latest static FFmpeg and FFprobe binaries
COPY --from=mwader/static-ffmpeg:latest /ffmpeg /usr/local/bin/ffmpeg
COPY --from=mwader/static-ffmpeg:latest /ffprobe /usr/local/bin/ffprobe
RUN chmod a+rx /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Install the latest release of yt-dlp from official GitHub Releases
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# Copy node modules from builder stage
COPY --from=builder /app/node_modules ./node_modules

# Copy the rest of the application files
COPY . .

# Ensure orchestration script is executable
RUN chmod +x entrypoint.sh

# Set environment variables
ENV NODE_ENV=production

# Expose SOCKS5 port just for explicit documentation
EXPOSE 8010

# Start the bot via orchestration script
ENTRYPOINT ["./entrypoint.sh"]
