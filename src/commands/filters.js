const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// DisTube FFmpeg filter presets
// These are applied via ffmpeg audio filters
const filterPresets = {
  bassboost: 'bass=g=10',
  '3d': 'apulsator=hz=0.125',
  vaporwave: 'asetrate=44100*0.8,aresample=44100,atempo=1.1',
  nightcore: 'asetrate=44100*1.25,aresample=44100',
  phaser: 'aphaser=in_gain=0.4',
  tremolo: 'tremolo',
  vibrato: 'vibrato=f=6.5',
  reverse: 'areverse',
  treble: 'treble=g=5',
  normalizer: 'dynaudnorm=g=101',
  surrounding: 'surround',
  pulsator: 'apulsator=hz=1',
  subboost: 'asubboost',
  karaoke: 'stereotools=mlev=0.03',
  flanger: 'flanger',
  gate: 'agate',
  haas: 'haas',
  mcompand: 'mcompand',
  earwax: 'earwax'
};

// Human-readable names
const filterNames = {
  bassboost: '🔊 Bass Boost',
  '3d': '🎧 3D Audio',
  vaporwave: '🌊 Vaporwave',
  nightcore: '🌙 Nightcore',
  phaser: '🌀 Phaser',
  tremolo: '〰️ Tremolo',
  vibrato: '🎸 Vibrato',
  reverse: '⏪ Reverse',
  treble: '🔉 Treble Boost',
  normalizer: '📊 Normalizer',
  surrounding: '🔈 Surround',
  pulsator: '💓 Pulsator',
  subboost: '💥 Sub Boost',
  karaoke: '🎤 Karaoke',
  flanger: '🌊 Flanger',
  gate: '🚪 Gate',
  haas: '👂 Haas',
  mcompand: '📈 Multi-band Compand',
  earwax: '👂 Earwax (headphone enhancement)'
};

const commands = {
  filter: {
    data: new SlashCommandBuilder()
      .setName('filter')
      .setDescription('Apply an audio filter')
      .addStringOption(option =>
        option.setName('preset')
          .setDescription('Filter preset to apply')
          .setRequired(true)
          .addChoices(
            { name: '🔊 Bass Boost', value: 'bassboost' },
            { name: '🌙 Nightcore', value: 'nightcore' },
            { name: '🌊 Vaporwave', value: 'vaporwave' },
            { name: '🎧 3D Audio', value: '3d' },
            { name: '〰️ Tremolo', value: 'tremolo' },
            { name: '🎸 Vibrato', value: 'vibrato' },
            { name: '🎤 Karaoke', value: 'karaoke' },
            { name: '🔉 Treble Boost', value: 'treble' },
            { name: '💥 Sub Boost', value: 'subboost' },
            { name: '🌀 Phaser', value: 'phaser' }
          )
      ),

    async execute(interaction, client) {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs[0]) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const preset = interaction.options.getString('preset');
      const filter = filterPresets[preset];
      
      if (!filter) {
        return interaction.reply({ content: 'Unknown filter preset.', ephemeral: true });
      }
      
      try {
        // Check if filter is already active
        if (queue.filters.has(preset)) {
          queue.filters.remove(preset);
          return interaction.reply(`🔇 Removed **${filterNames[preset] || preset}** filter`);
        }
        
        // Add the filter
        queue.filters.add(preset);
        return interaction.reply(`✅ Applied **${filterNames[preset] || preset}** filter!`);
      } catch (error) {
        return interaction.reply({ content: `❌ Failed to apply filter: ${error.message}`, ephemeral: true });
      }
    }
  },

  clearfilter: {
    data: new SlashCommandBuilder()
      .setName('clearfilter')
      .setDescription('Clear all audio filters'),

    async execute(interaction, client) {
      const queue = client.distube.getQueue(interaction.guildId);
      if (!queue || !queue.songs[0]) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      try {
        // Clear all filters
        if (queue.filters.size === 0) {
          return interaction.reply({ content: 'No filters are currently active.', ephemeral: true });
        }
        
        queue.filters.clear();
        return interaction.reply('🔇 Cleared all filters!');
      } catch (error) {
        return interaction.reply({ content: `❌ Failed to clear filters: ${error.message}`, ephemeral: true });
      }
    }
  },

  filters: {
    data: new SlashCommandBuilder()
      .setName('filters')
      .setDescription('Show active filters and available presets'),

    async execute(interaction, client) {
      const queue = client.distube.getQueue(interaction.guildId);
      
      const embed = new EmbedBuilder()
        .setTitle('🎛️ Audio Filters')
        .setColor('#5865F2');
      
      // Show active filters
      if (queue?.filters?.size) {
        const activeList = queue.filters.names
          .map(name => filterNames[name] || name)
          .join(', ');
        embed.addFields({
          name: '✅ Active Filters',
          value: activeList || 'None'
        });
      } else {
        embed.addFields({
          name: '✅ Active Filters',
          value: 'None'
        });
      }
      
      // Show available presets
      const presetList = Object.keys(filterPresets)
        .slice(0, 15)
        .map(p => `\`${p}\``)
        .join(', ');
      
      embed.addFields({
        name: '📋 Available Presets',
        value: presetList
      });
      
      embed.addFields({
        name: '📖 Usage',
        value: '`/filter <preset>` - Toggle a filter (apply/remove)\n`/clearfilter` - Remove all filters'
      });
      
      embed.setFooter({ text: 'Filters use FFmpeg audio processing' });
      
      return interaction.reply({ embeds: [embed] });
    }
  }
};

// Export filter presets for DisTube configuration
module.exports = commands;
module.exports.filterPresets = filterPresets;
