require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Services
const spotifyService = require('./services/spotify');

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
    console.error('✗ Error registering commands:', error);
  }
}

// Bot ready event
client.once('ready', async () => {
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
    console.warn(`Unknown command: ${interaction.commandName}`);
    return interaction.reply({ content: 'Unknown command.', ephemeral: true });
  }

  try {
    await command.execute(interaction, client);
  } catch (error) {
    console.error(`Error executing ${interaction.commandName}:`, error);
    
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
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Initialize and start
async function start() {
  console.log('🎵 Discord Music Bot Starting...\n');
  
  // Load commands
  console.log('Loading commands...');
  loadCommands();
  console.log(`✓ Loaded ${client.commands.size} commands\n`);
  
  // Initialize Spotify
  console.log('Initializing Spotify...');
  await spotifyService.initialize();
  
  // Login to Discord
  console.log('Connecting to Discord...');
  await client.login(process.env.BOT_TOKEN);
}

start().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
