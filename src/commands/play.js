const { SlashCommandBuilder } = require('discord.js');
const { getVoiceConnection, VoiceConnectionStatus } = require('@discordjs/voice');
const { getVoiceChannel, getBotVoicePermissionIssue, isGuildInteraction } = require('../utils/permissions');
const { logger } = require('../utils/logger');
const distubeService = require('../services/distube');
const { loadSettings, canUseVoiceChannel } = require('../services/serverSettings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play from YouTube, Spotify, SoundCloud, Bandcamp, Vimeo, or a direct URL/stream.')
    .addStringOption(option =>
      option.setName('query')
        .setDescription('URL, search term, or radio preset (lofi, jazz, classical, chillhop, synthwave)')
        .setRequired(true)
    ),

  async execute(interaction, client) {
    if (!isGuildInteraction(interaction)) {
      return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    }

    const voiceChannel = getVoiceChannel(interaction.member);
    if (!voiceChannel) {
      return interaction.reply({ content: 'You must join a voice channel first!', ephemeral: true });
    }

    // Check voice channel lock
    const settings = loadSettings(interaction.guildId);
    if (!canUseVoiceChannel(interaction.guildId, voiceChannel.id)) {
      return interaction.reply({ 
        content: `🔒 Bot is locked to <#${settings.voiceChannelId}>. Please join that channel.`, 
        ephemeral: true 
      });
    }

    const voicePermissionIssue = getBotVoicePermissionIssue(interaction.guild, voiceChannel);
    if (voicePermissionIssue) {
      return interaction.reply({ content: '❌ ' + voicePermissionIssue, ephemeral: true });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query');
    const guildId = interaction.guildId;
    const requesterId = interaction.user.id;

    // Prevent concurrent /play joins in the same guild (common source of voice join races)
    if (!client.playInitLocks) client.playInitLocks = new Set();
    if (client.playInitLocks.has(guildId)) {
      return interaction.editReply({
        content: '⏳ Another play request is already initializing voice for this server. Please retry in a few seconds.'
      });
    }
    client.playInitLocks.add(guildId);

    logger.command('play', requesterId, guildId, { query: query.substring(0, 100) });

    try {
      const distube = client.distube;

      // Brand-new queue path: clear any stale/disconnected voice state first.
      // This prevents hidden leftover @discordjs/voice sessions from blocking joins.
      if (!distube.getQueue(guildId)) {
        await cleanupVoiceConnections(client, guildId);
      }
      
      // Determine queue position based on queue type (fair queue support)
      let position = undefined;
      if (settings.queueType === 'fair') {
        const queue = distube.getQueue(guildId);
        if (queue && queue.songs.length > 1) {
          position = calculateFairPosition(queue, requesterId);
        }
      }
      
      // Check for radio preset first
      const presetUrl = distubeService.getRadioPreset(query);
      if (presetUrl) {
        logger.urlDetection(query, 'radio-preset');
        await playWithVoiceRetry(client, voiceChannel, presetUrl, {
          textChannel: interaction.channel,
          member: interaction.member,
          position
        }, logger);
        return interaction.editReply('📻 Playing radio: **' + query + '**');
      }

      // Check if it is a direct stream URL
      if (distubeService.isStreamUrl(query)) {
        logger.urlDetection(query, 'stream');
        await playWithVoiceRetry(client, voiceChannel, query, {
          textChannel: interaction.channel,
          member: interaction.member,
          position
        }, logger);
        return interaction.editReply('📡 Playing stream');
      }

      // Send initial "processing" message and store it for later editing
      const replyMsg = await interaction.editReply('🔍 Processing: **' + query.substring(0, 100) + '**...');

      // Check if query is a URL (let DisTube handle URLs directly)
      const isUrl = /^https?:\/\//.test(query);
      
      if (!isUrl) {
        // For search terms, use yt-dlp directly to search YouTube
        logger.urlDetection(query, 'youtube-search');
        const ytdlpPlugin = distube.ytdlpPlugin;
        
        if (ytdlpPlugin) {
          const results = await ytdlpPlugin.search(query, 1);
          if (results && results.length > 0) {
            // Play the first YouTube result
            await playWithVoiceRetry(client, voiceChannel, results[0].url, {
              textChannel: interaction.channel,
              member: interaction.member,
              position,
              metadata: { 
                replyMessage: replyMsg,
                maxDuration: settings.maxDuration
              }
            }, logger);
            return;
          }
        }
        // Fall through to DisTube if yt-dlp search fails
      }

      // Let DisTube handle URLs (YouTube, Spotify, SoundCloud)
      logger.urlDetection(query, 'distube-auto');
      
      await playWithVoiceRetry(client, voiceChannel, query, {
        textChannel: interaction.channel,
        member: interaction.member,
        position,
        metadata: { 
          replyMessage: replyMsg,
          maxDuration: settings.maxDuration // Pass max duration for validation in event handler
        }
      }, logger);
      
      // The PLAY_SONG event will update the message to "Now playing"
      return;

    } catch (error) {
      logger.error('Play', 'Command failed for query: ' + query.substring(0, 50), error);

      const isVoiceConnectFailure =
        error?.code === 'VOICE_CONNECT_FAILED'
        || /Cannot connect to the voice channel after 30 seconds/i.test(error?.message || '');

      if (isVoiceConnectFailure) {
        const issue = getBotVoicePermissionIssue(interaction.guild, voiceChannel);
        const guidance = issue
          ? issue
          : 'Voice join failed after retry. Check runtime alignment (Node + discord.js + @discordjs/voice), ensure only one bot process is running, then restart and retry.';
        return interaction.editReply({ content: '❌ ' + guidance });
      }

      return interaction.editReply({ content: '❌ Error: ' + error.message.slice(0, 200) });
    } finally {
      client.playInitLocks.delete(guildId);
    }
  }
};

function isVoiceConnectFailure(error) {
  return error?.code === 'VOICE_CONNECT_FAILED'
    || /Cannot connect to the voice channel after 30 seconds/i.test(error?.message || '');
}

function getVoiceDiagnostics(client, voiceChannel) {
  const guildId = voiceChannel.guildId;
  const groupedConnection = getVoiceConnection(guildId, client.user?.id);
  const defaultConnection = getVoiceConnection(guildId);
  const distubeVoice = client.distube?.voices?.get(guildId);

  return {
    guildId,
    channelId: voiceChannel.id,
    channelType: voiceChannel.type,
    channelJoinable: voiceChannel.joinable,
    channelFull: voiceChannel.full,
    botVoiceChannelId: voiceChannel.guild?.members?.me?.voice?.channelId || null,
    hasDisTubeVoice: Boolean(distubeVoice),
    distubeVoiceChannelId: distubeVoice?.channelId || null,
    groupedConnectionState: groupedConnection?.state?.status || null,
    defaultConnectionState: defaultConnection?.state?.status || null,
    node: process.version
  };
}

async function cleanupVoiceConnections(client, guildId) {
  try {
    if (client.distube?.voices?.get(guildId)) {
      client.distube.voices.leave(guildId);
    }
  } catch {}

  try {
    const groupedConnection = getVoiceConnection(guildId, client.user?.id);
    if (groupedConnection && groupedConnection.state.status !== VoiceConnectionStatus.Destroyed) {
      groupedConnection.destroy();
    }
  } catch {}

  try {
    const defaultConnection = getVoiceConnection(guildId);
    if (defaultConnection && defaultConnection.state.status !== VoiceConnectionStatus.Destroyed) {
      defaultConnection.destroy();
    }
  } catch {}

  await new Promise(resolve => setTimeout(resolve, 400));
}

async function playWithVoiceRetry(client, voiceChannel, song, options, logger) {
  try {
    return await client.distube.play(voiceChannel, song, options);
  } catch (error) {
    if (!isVoiceConnectFailure(error)) throw error;

    const guildId = voiceChannel.guildId;
    logger.warn('Play', `VOICE_CONNECT_FAILED (attempt 1) for guild ${guildId}`, getVoiceDiagnostics(client, voiceChannel));

    await cleanupVoiceConnections(client, guildId);

    logger.warn('Play', `Retrying voice join once for guild ${guildId}`);
    return client.distube.play(voiceChannel, song, options);
  }
}

/**
 * Calculate the fair queue position for a user
 * Fair queue alternates between users to prevent queue domination
 */
function calculateFairPosition(queue, userId) {
  // Get all unique requesters in order
  const songs = queue.songs;
  if (songs.length <= 1) return undefined;
  
  // Find the last song by this user
  let lastUserSongIndex = -1;
  for (let i = songs.length - 1; i >= 0; i--) {
    if (songs[i].member?.id === userId) {
      lastUserSongIndex = i;
      break;
    }
  }
  
  // If user has no songs in queue, add at the end
  if (lastUserSongIndex === -1) {
    return undefined; // Default position (end)
  }
  
  // Find the next slot after another user's song
  for (let i = lastUserSongIndex + 1; i < songs.length; i++) {
    if (songs[i].member?.id !== userId) {
      return i + 1; // Insert after this song
    }
  }
  
  // No interleaving possible, add at end
  return undefined;
}
