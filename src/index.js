require('dotenv').config();
const { Client, GatewayIntentBits, Collection, REST, Routes, ActivityType } = require('discord.js');
const { Kazagumo, Plugins } = require('kazagumo');
const { Connectors } = require('shoukaku');
const fs = require('fs');
const path = require('path');
const { logger } = require('./utils/logger');

// Initialize Discord client
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

// Lavalink nodes configuration
const nodes = [
  {
    name: 'Main',
    url: process.env.LAVALINK_HOST || 'localhost:2333',
    auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: false
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

// Helper function
function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
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

  const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

  try {
    console.log(`Registering ${commands.length} slash commands...`);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✓ Successfully registered slash commands.');
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

// Player events
kazagumo.on('playerStart', (player, track) => {
  const channel = client.channels.cache.get(player.textId);
  if (channel) {
    channel.send(`🎵 Now playing: **${track.title}** - \`${formatDuration(track.length)}\``);
  }
  player.skipVotes = new Set();
});

kazagumo.on('playerEmpty', (player) => {
  const channel = client.channels.cache.get(player.textId);
  if (channel) {
    channel.send('✅ Queue finished! Use `/play` to add more songs.');
  }
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

// Discord events
client.once('ready', async () => {
  console.log(`\n🤖 Logged in as ${client.user.tag}`);
  
  client.user.setActivity('music | /help', { type: ActivityType.Listening });
  await registerCommands();
  
  console.log('✓ Bot is ready!\n');
});

client.on('interactionCreate', async interaction => {
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
  await client.login(process.env.BOT_TOKEN);
}

start().catch(error => {
  logger.error('Bot', 'Failed to start', error);
  process.exit(1);
});
