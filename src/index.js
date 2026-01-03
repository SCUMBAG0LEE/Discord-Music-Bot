require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');
const distubeService = require('./services/distube');

// Initialize Discord client with required intents
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
});

// Command collection
client.commands = new Collection();

// DisTube will be attached to client after initialization
client.distube = null;

/**
 * Load all commands from the commands directory
 */
function loadCommands() {
  const commandsPath = path.join(__dirname, 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);

    // Handle single command exports (like play.js, search.js, queue.js)
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
      console.log(`  ✓ Loaded command: ${command.data.name}`);
    }
    // Handle multiple command exports (like playback.js, queueManagement.js)
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
  
  client.commands.forEach(cmd => {
    commands.push(cmd.data.toJSON());
  });

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    console.log(`Registering ${commands.length} slash commands...`);
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log('✓ Successfully registered slash commands.');
  } catch (error) {
    logger.error('Bot', 'Error registering commands', error);
  }
}

// Bot ready event
client.once('clientReady', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  
  // Set activity
  client.user.setActivity('music | /help', { 
    type: ActivityType.Listening
  });

  // Register commands
  await registerCommands();
  
  console.log('✓ Bot is ready!\n');
});

// Interaction handler
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    logger.warn('Bot', `Unknown command attempted: ${interaction.commandName}`);
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
client.on('error', error => {
  logger.error('Discord', 'Client error', error);
});

process.on('unhandledRejection', error => {
  logger.error('Process', 'Unhandled promise rejection', error);
});

// Initialize and start
async function start() {
  logger.info('Bot', '🎵 Discord Music Bot v4.3.0 (DisTube) Starting...');
  
  // Load commands
  logger.info('Bot', 'Loading commands...');
  loadCommands();
  logger.success('Bot', `Loaded ${client.commands.size} commands`);
  
  // Initialize DisTube (after commands load, before login)
  logger.info('Bot', 'Initializing DisTube...');
  client.distube = distubeService.initialize(client);
  
  // Login to Discord
  logger.info('Bot', 'Connecting to Discord...');
  await client.login(process.env.BOT_TOKEN);
}

start().catch(error => {
  logger.error('Bot', 'Failed to start', error);
  process.exit(1);
});
