require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType, PresenceUpdateStatus } = require('discord.js');
const { Kazagumo, Plugins } = require('kazagumo');
const { Connectors } = require('shoukaku');
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const { formatDuration } = require('./utils/formatters');
const { loadSettings, canUseTextChannel, canUseVoiceChannel, getEffectiveSkipRatio } = require('./services/serverSettings');
const { getPlaylist } = require('./services/playlists');

// Parse activity type from string
function parseActivityType(type) {
  const types = {
    'PLAYING': ActivityType.Playing,
    'LISTENING': ActivityType.Listening,
    'WATCHING': ActivityType.Watching,
    'COMPETING': ActivityType.Competing,
    'STREAMING': ActivityType.Streaming
  };
  return types[type?.toUpperCase()] || ActivityType.Listening;
}

// Bot settings from env
const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.OWNER_ID || '',
  djRoleId: process.env.DJ_ROLE_ID || '',
  defaultVolume: parseInt(process.env.DEFAULT_VOLUME) || 100,
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 0,         // 0 = unlimited
  maxDuration: parseInt(process.env.MAX_DURATION) || 0,            // 0 = unlimited (in seconds)
  skipRatio: parseFloat(process.env.SKIP_RATIO) || 0.5,            // 50% of listeners needed to skip
  aloneTimeUntilStop: parseInt(process.env.ALONE_TIME) || 60,      // seconds before leaving empty VC
  idleTimeUntilStop: parseInt(process.env.IDLE_TIME) || 120,       // seconds before leaving when paused/idle
  stayInChannel: process.env.STAY_IN_CHANNEL === 'true',           // 24/7 mode
  npImages: process.env.NP_IMAGES !== 'false',                     // show thumbnails in now playing
  activityType: parseActivityType(process.env.BOT_ACTIVITY_TYPE),
  activityName: process.env.BOT_ACTIVITY_NAME || 'music | /help',
  status: process.env.BOT_STATUS || 'online'
};

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
});

// Attach config to client
client.config = config;

// Song in status tracking (global toggle)
client.songInStatus = false;

// Command collection
client.commands = new Collection();

// Lavalink nodes configuration
const nodes = [
  {
    name: 'Main',
    url: process.env.LAVALINK_HOST || 'localhost:2333',
    auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: process.env.LAVALINK_SECURE === 'true'
  }
];

// Initialize Kazagumo (Lavalink wrapper with queue management)
const kazagumo = new Kazagumo({
  defaultSearchEngine: 'youtube',
  plugins: [
    new Plugins.PlayerMoved(client)
  ],
  send: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  }
}, new Connectors.DiscordJS(client), nodes, {
  moveOnDisconnect: false,
  reconnectTries: 3,
  reconnectInterval: 5000
});

// Attach to client for access in commands
client.kazagumo = kazagumo;

// Idle/alone timeout trackers
const timeouts = new Map();

// Clear timeout for a guild
function clearGuildTimeout(guildId) {
  const existing = timeouts.get(guildId);
  if (existing) {
    clearTimeout(existing);
    timeouts.delete(guildId);
  }
}

// Start idle timeout (no music playing)
function startIdleTimeout(player) {
  if (config.stayInChannel || player.data.stayInChannel) return;
  
  clearGuildTimeout(player.guildId);
  
  const timeout = setTimeout(() => {
    const channel = client.channels.cache.get(player.textId);
    if (channel) {
      channel.send('⏹️ Left voice channel due to inactivity.');
    }
    player.destroy();
    timeouts.delete(player.guildId);
  }, config.idleTimeUntilStop * 1000);
  
  timeouts.set(player.guildId, timeout);
}

// Start alone timeout (empty VC)
function startAloneTimeout(player) {
  if (config.stayInChannel || player.data.stayInChannel) return;
  
  clearGuildTimeout(player.guildId);
  
  const timeout = setTimeout(() => {
    const channel = client.channels.cache.get(player.textId);
    if (channel) {
      channel.send('⏹️ Left voice channel - no one else is here.');
    }
    player.destroy();
    timeouts.delete(player.guildId);
  }, config.aloneTimeUntilStop * 1000);
  
  timeouts.set(player.guildId, timeout);
}

// Load commands
function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      console.log(`  ✓ Loaded command: ${command.data.name}`);
    } else {
      for (const [name, cmd] of Object.entries(command)) {
        if (cmd.data && cmd.execute) {
          client.commands.set(cmd.data.name, cmd);
          console.log(`  ✓ Loaded command: ${cmd.data.name}`);
        }
      }
    }
  }
}

// Register slash commands
async function registerCommands() {
  const commands = [];
  client.commands.forEach(cmd => commands.push(cmd.data.toJSON()));

  const rest = new REST({ version: '10' }).setToken(config.token);

  try {
    console.log(`Registering ${commands.length} slash commands...`);
    
    if (process.env.GUILD_ID) {
      // Register to specific guild (instant)
      await rest.put(
        Routes.applicationGuildCommands(config.clientId || client.user.id, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`✓ Registered commands to guild ${process.env.GUILD_ID}`);
    } else {
      // Register globally (takes up to 1 hour)
      await rest.put(
        Routes.applicationCommands(config.clientId || client.user.id),
        { body: commands }
      );
      console.log('✓ Registered commands globally');
    }
  } catch (error) {
    logger.error('Bot', 'Error registering commands', error);
  }
}

// Lavalink events
kazagumo.shoukaku.on('ready', (name) => {
  logger.success('Lavalink', `Node "${name}" connected`);
});

kazagumo.shoukaku.on('error', (name, error) => {
  logger.error('Lavalink', `Node "${name}" error: ${error.message}`);
});

kazagumo.shoukaku.on('close', (name, code, reason) => {
  logger.warn('Lavalink', `Node "${name}" closed (${code}): ${reason || 'No reason'}`);
});

// Automatic reconnection when node disconnects (after built-in retries exhausted)
kazagumo.shoukaku.on('disconnect', (name, count) => {
  logger.warn('Lavalink', `Node "${name}" disconnected. Reconnect attempts: ${count}`);
  
  // If built-in reconnects failed, start manual infinite retry
  if (count >= 3) {
    logger.info('Lavalink', `Starting infinite reconnect loop for node "${name}"...`);
    
    const retryConnect = setInterval(async () => {
      try {
        const node = kazagumo.shoukaku.nodes.get(name);
        if (node && node.state === 'CONNECTED') {
          logger.success('Lavalink', `Node "${name}" reconnected!`);
          clearInterval(retryConnect);
          return;
        }
        
        logger.info('Lavalink', `Attempting to reconnect node "${name}"...`);
        // Force reconnect by removing and re-adding the node
        kazagumo.shoukaku.nodes.delete(name);
        await kazagumo.shoukaku.addNode({
          name: 'Main',
          url: process.env.LAVALINK_HOST || 'localhost:2333',
          auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
          secure: process.env.LAVALINK_SECURE === 'true'
        });
        logger.success('Lavalink', `Node "${name}" reconnected!`);
        clearInterval(retryConnect);
      } catch (error) {
        logger.warn('Lavalink', `Reconnect failed, retrying in 5s... (${error.message})`);
      }
    }, 5000);
  }
});

// Player create event - load autoplaylist if configured
kazagumo.on('playerCreate', async (player) => {
  const settings = loadSettings(player.guildId);
  
  if (settings.autoPlaylist) {
    const { userId, name } = settings.autoPlaylist;
    const playlist = getPlaylist(userId, name);
    
    if (playlist && playlist.tracks.length > 0) {
      logger.info('Player', `Loading autoplaylist "${name}" for guild ${player.guildId}`);
      
      // Load tracks from autoplaylist
      let added = 0;
      for (const track of playlist.tracks) {
        try {
          const result = await kazagumo.search(track.uri || track.title, { requester: null });
          if (result?.tracks?.length) {
            player.queue.add(result.tracks[0]);
            added++;
          }
        } catch (e) {
          // Skip failed tracks silently
        }
      }
      
      if (added > 0) {
        const channel = client.channels.cache.get(player.textId);
        if (channel) {
          channel.send(`📂 Auto-loaded **${name}** playlist (${added} tracks)`);
        }
        
        // Start playing if not already
        if (!player.playing && !player.paused && player.queue.length > 0) {
          // Suppress "Now playing" since we already sent "Auto-loaded" message
          player.data.suppressNowPlaying = true;
          player.play();
        }
      }
    }
  }
});

// Player events
kazagumo.on('playerStart', (player, track) => {
  clearGuildTimeout(player.guildId);  // Clear any disconnect timeout
  
  // Check if this track was just started by a command (to avoid duplicate message)
  // Commands set player.data.suppressNowPlaying = true before calling play()
  if (player.data.suppressNowPlaying) {
    player.data.suppressNowPlaying = false;
  } else {
    // Send "Now playing" for automatic queue progression
    const channel = client.channels.cache.get(player.textId);
    if (channel) {
      channel.send(`🎵 Now playing: **${track.title}** - \`${formatDuration(track.length)}\``);
    }
  }
  
  // Reset vote skip for new track
  player.data.skipVotes = new Set();
  
  // Update bot status with current song if enabled
  const settings = loadSettings(player.guildId);
  if (settings.songInStatus || client.songInStatus) {
    client.user.setPresence({
      activities: [{ name: track.title.slice(0, 128), type: ActivityType.Listening }],
      status: config.status
    });
  }
});

kazagumo.on('playerEmpty', (player) => {
  const channel = client.channels.cache.get(player.textId);
  if (channel) {
    channel.send('✅ Queue finished! Use `/play` to add more songs.');
  }
  
  // Reset bot status to default
  const settings = loadSettings(player.guildId);
  if (settings.songInStatus || client.songInStatus) {
    client.user.setPresence({
      activities: [{ name: config.activityName, type: config.activityType }],
      status: config.status
    });
  }
  
  // Start idle timeout when queue ends
  startIdleTimeout(player);
});

kazagumo.on('playerError', (player, error) => {
  logger.error('Player', `Error: ${error.message || error}`);
  const channel = client.channels.cache.get(player.textId);
  if (channel) {
    channel.send(`❌ Player error: ${String(error).slice(0, 200)}`);
  }
});

kazagumo.on('playerResolveError', (player, track, error) => {
  logger.error('Player', `Failed to resolve: ${track.title} - ${error}`);
  const channel = client.channels.cache.get(player.textId);
  if (channel) {
    channel.send(`❌ Failed to play: **${track.title}**`);
  }
  player.skip();
});

// Voice state update - detect when bot is alone
client.on('voiceStateUpdate', (oldState, newState) => {
  // Only care about the guild where bot is playing
  const player = kazagumo.players.get(oldState.guild.id);
  if (!player) return;
  
  // Get bot's voice channel
  const botVoiceChannel = oldState.guild.channels.cache.get(player.voiceId);
  if (!botVoiceChannel) return;
  
  // Count members in channel (excluding bots)
  const members = botVoiceChannel.members.filter(m => !m.user.bot);
  
  if (members.size === 0) {
    // Bot is alone
    startAloneTimeout(player);
  } else {
    // Someone joined, cancel timeout
    clearGuildTimeout(player.guildId);
  }
});

// Discord events
client.once('clientReady', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  
  // Set activity and status from config
  client.user.setPresence({
    activities: [{ name: config.activityName, type: config.activityType }],
    status: config.status
  });
  
  await registerCommands();
  
  console.log('✓ Bot is ready!\n');
});

client.on('interactionCreate', async interaction => {
  // Handle autocomplete
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    if (command?.autocomplete) {
      try {
        await command.autocomplete(interaction, client);
      } catch (error) {
        console.error('Autocomplete error:', error);
      }
    }
    return;
  }
  
  // Check text channel lock (skip for owner)
  if (interaction.guildId && interaction.isChatInputCommand()) {
    const isOwnerUser = client.config.ownerId === interaction.user.id;
    if (!isOwnerUser && !canUseTextChannel(interaction.guildId, interaction.channelId)) {
      const settings = loadSettings(interaction.guildId);
      return interaction.reply({ 
        content: `❌ Bot commands are restricted to <#${settings.textChannelId}>`, 
        ephemeral: true 
      });
    }
  }
  
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    logger.error('Bot', `Error executing /${interaction.commandName}`, error);
    const errorMessage = { content: 'There was an error executing this command.', ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(errorMessage).catch(() => {});
    } else {
      await interaction.reply(errorMessage).catch(() => {});
    }
  }
});

client.on('messageCreate', message => {
  if (message.author.bot) return;
  if (message.mentions.has(client.user)) {
    message.reply('👋 Hey! Use `/help` to see my commands!');
  }
});

// Error handling
client.on('error', error => logger.error('Discord', 'Client error', error));
process.on('unhandledRejection', error => logger.error('Process', 'Unhandled rejection', error));

// Start
async function start() {
  const pkg = require('../package.json');
  logger.info('Bot', `🎵 Discord Music Bot v${pkg.version} (Lavalink) Starting...`);
  
  logger.info('Bot', 'Loading commands...');
  loadCommands();
  logger.success('Bot', `Loaded ${client.commands.size} commands`);
  
  logger.info('Bot', 'Connecting to Discord & Lavalink...');
  await client.login(config.token);
}

start().catch(error => {
  logger.error('Bot', 'Failed to start', error);
  process.exit(1);
});
