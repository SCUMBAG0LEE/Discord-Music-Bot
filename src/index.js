/**
 * Discord Music Bot - Main Entry Point
 * DisTube + yt-dlp based music bot
 */

require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const { loadSettings, canUseTextChannel } = require('./services/serverSettings');
const distubeService = require('./services/distube');

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

// Bot configuration from environment
const config = {
  token: process.env.BOT_TOKEN,
  clientId: process.env.CLIENT_ID,
  ownerId: process.env.BOT_OWNER_ID || '',
  djRoleId: process.env.DJ_ROLE_ID || '',
  defaultVolume: parseInt(process.env.DEFAULT_VOLUME) || 50,
  maxQueueSize: parseInt(process.env.MAX_QUEUE_SIZE) || 100,       // Max songs in queue (0 = unlimited)
  maxDuration: parseInt(process.env.MAX_DURATION) || 0,            // 0 = unlimited (in seconds)
  skipRatio: parseFloat(process.env.SKIP_RATIO) || 0.5,            // 50% of listeners needed to skip
  aloneTimeUntilStop: parseInt(process.env.ALONE_TIMEOUT) || 60,   // seconds before leaving empty VC
  idleTimeUntilStop: parseInt(process.env.IDLE_TIMEOUT) || 300,    // seconds before leaving when paused/idle
  stayInChannel: process.env.STAY_IN_CHANNEL === 'true',           // 24/7 mode
  songInStatus: process.env.SONG_IN_STATUS === 'true',             // show current song in bot status
  activityType: parseActivityType(process.env.ACTIVITY_TYPE) || 'PLAYING',
  activityName: process.env.ACTIVITY_NAME || 'music | /help',
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

// DisTube will be attached after initialization
client.distube = null;

// Idle/alone timeout trackers
const timeouts = new Map();

/**
 * Clear timeout for a guild
 */
function clearGuildTimeout(guildId) {
  const existing = timeouts.get(guildId);
  if (existing) {
    clearTimeout(existing);
    timeouts.delete(guildId);
  }
}

/**
 * Force leave voice channel for a guild
 */
function leaveVoiceChannel(guildId) {
  try {
    // Try to stop the queue first (cleans up DisTube state)
    const queue = client.distube?.getQueue(guildId);
    if (queue) {
      queue.stop();
      return;
    }
    
    // If no queue, use @discordjs/voice to disconnect
    const { getVoiceConnection } = require('@discordjs/voice');
    const connection = getVoiceConnection(guildId);
    if (connection) {
      connection.destroy();
    }
  } catch (err) {
    // Fallback: try to leave via guild
    const guild = client.guilds.cache.get(guildId);
    if (guild?.members?.me?.voice?.channel) {
      guild.members.me.voice.disconnect().catch(() => {});
    }
  }
}

/**
 * Start idle timeout (no music playing)
 */
function startIdleTimeout(queue) {
  const guildId = queue.id;
  const settings = loadSettings(guildId);
  
  if (config.stayInChannel || settings.stayInChannel || queue.stayInChannel) return;
  
  clearGuildTimeout(guildId);
  
  const timeout = setTimeout(() => {
    queue.textChannel?.send('⏹️ Left voice channel due to inactivity.');
    leaveVoiceChannel(guildId);
    timeouts.delete(guildId);
  }, config.idleTimeUntilStop * 1000);
  
  timeouts.set(guildId, timeout);
}

/**
 * Start alone timeout (empty VC)
 */
function startAloneTimeout(queue) {
  const guildId = queue.id;
  const settings = loadSettings(guildId);
  
  if (config.stayInChannel || settings.stayInChannel || queue.stayInChannel) return;
  
  clearGuildTimeout(guildId);
  
  const timeout = setTimeout(() => {
    queue.textChannel?.send('⏹️ Left voice channel - no one else is here.');
    leaveVoiceChannel(guildId);
    timeouts.delete(guildId);
  }, config.aloneTimeUntilStop * 1000);
  
  timeouts.set(guildId, timeout);
}

// Expose timeout functions on client for DisTube service
client.startIdleTimeout = startIdleTimeout;
client.startAloneTimeout = startAloneTimeout;
client.clearGuildTimeout = clearGuildTimeout;

/**
 * Load all commands from the commands directory
 */
function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    // Handle single command exports
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      console.log(`  ✓ Loaded command: ${command.data.name}`);
    }
    // Handle multiple command exports
    else {
      for (const [name, cmd] of Object.entries(command)) {
        if (cmd.data && cmd.execute) {
          client.commands.set(cmd.data.name, cmd);
          console.log(`  ✓ Loaded command: ${cmd.data.name}`);
        }
      }
    }
  }
}

/**
 * Register slash commands with Discord
 */
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

// Voice state update - detect when bot is alone
client.on('voiceStateUpdate', (oldState, newState) => {
  const queue = client.distube?.getQueue(oldState.guild.id);
  if (!queue) return;
  
  // Get bot's voice channel
  const botVoiceChannel = queue.voiceChannel;
  if (!botVoiceChannel) return;
  
  // Count members in channel (excluding bots)
  const members = botVoiceChannel.members.filter(m => !m.user.bot);
  
  if (members.size === 0) {
    // Bot is alone
    startAloneTimeout(queue);
  } else {
    // Someone joined, cancel timeout
    clearGuildTimeout(queue.id);
  }
});

// Bot ready event
// Bot ready event
client.once('clientReady', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);

  // NEW: Activity Configuration Logic
  const activityConfig = {
    name: config.activityName,
    type: config.activityType
  };

  // If the type is STREAMING, we move the activityName to the 'url' field
  // and set a generic name (or you can customize the name here).
  if (config.activityType === ActivityType.Streaming) {
    activityConfig.url = config.activityName; // Use the URL from .env
    activityConfig.name = "/help";      // This is the "Streaming [Name]" text
  }

  // Set activity and status from config
  client.user.setPresence({
    activities: [activityConfig],
    status: config.status
  });

  await registerCommands();

  console.log('✓ Bot is ready!\n');
});

// Interaction handler
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

// Message handler for mentions
client.on('messageCreate', message => {
  if (message.author.bot) return;
  if (message.mentions.has(client.user)) {
    message.reply('👋 Hey! Use `/help` to see my commands!');
  }
});

// Error handling
client.on('error', error => logger.error('Discord', 'Client error', error));
process.on('unhandledRejection', error => logger.error('Process', 'Unhandled rejection', error));

// Initialize and start
async function start() {
  const pkg = require('../package.json');
  logger.info('Bot', `🎵 Discord Music Bot v${pkg.version} (DisTube + yt-dlp) Starting...`);
  
  // Load commands
  logger.info('Bot', 'Loading commands...');
  loadCommands();
  logger.success('Bot', `Loaded ${client.commands.size} commands`);
  
  // Initialize DisTube
  logger.info('Bot', 'Initializing DisTube...');
  client.distube = distubeService.initialize(client);
  
  // Login to Discord
  logger.info('Bot', 'Connecting to Discord...');
  await client.login(config.token);
}

start().catch(error => {
  logger.error('Bot', 'Failed to start', error);
  process.exit(1);
});
