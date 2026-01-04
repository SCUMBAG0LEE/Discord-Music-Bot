const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Lavalink filter presets
const filterPresets = {
  bassboost: { equalizer: [
    { band: 0, gain: 0.6 },
    { band: 1, gain: 0.7 },
    { band: 2, gain: 0.8 },
    { band: 3, gain: 0.55 },
    { band: 4, gain: 0.25 }
  ]},
  nightcore: { timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 }},
  vaporwave: { timescale: { speed: 0.85, pitch: 0.9, rate: 1.0 }},
  '8d': { rotation: { rotationHz: 0.2 }},
  tremolo: { tremolo: { frequency: 4.0, depth: 0.75 }},
  vibrato: { vibrato: { frequency: 4.0, depth: 0.75 }},
  karaoke: { karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220, filterWidth: 100 }},
  lowpass: { lowPass: { smoothing: 20.0 }},
  soft: { equalizer: [
    { band: 0, gain: -0.25 },
    { band: 1, gain: -0.25 },
    { band: 2, gain: -0.125 },
    { band: 3, gain: 0 }
  ]},
  trebleboost: { equalizer: [
    { band: 10, gain: 0.6 },
    { band: 11, gain: 0.65 },
    { band: 12, gain: 0.7 },
    { band: 13, gain: 0.75 }
  ]}
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
            { name: '🎧 8D Audio', value: '8d' },
            { name: '〰️ Tremolo', value: 'tremolo' },
            { name: '🎸 Vibrato', value: 'vibrato' },
            { name: '🎤 Karaoke', value: 'karaoke' },
            { name: '🔈 Low Pass', value: 'lowpass' },
            { name: '🎵 Soft', value: 'soft' },
            { name: '🔉 Treble Boost', value: 'trebleboost' }
          )
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const preset = interaction.options.getString('preset');
      const filter = filterPresets[preset];
      
      if (!filter) {
        return interaction.reply({ content: 'Unknown filter preset.', ephemeral: true });
      }
      
      // Apply filter through shoukaku
      await player.shoukaku.setFilters(filter);
      
      // Store active filters for clearfilter command
      if (!player.data.activeFilters) player.data.activeFilters = new Set();
      player.data.activeFilters.add(preset);
      
      return interaction.reply(`✅ Applied **${preset}** filter!`);
    }
  },

  clearfilter: {
    data: new SlashCommandBuilder()
      .setName('clearfilter')
      .setDescription('Clear all audio filters'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      // Clear all filters
      await player.shoukaku.clearFilters();
      
      if (player.data.activeFilters) {
        player.data.activeFilters.clear();
      }
      
      return interaction.reply('🔇 Cleared all filters!');
    }
  },

  speed: {
    data: new SlashCommandBuilder()
      .setName('speed')
      .setDescription('Adjust playback speed')
      .addNumberOption(option =>
        option.setName('rate')
          .setDescription('Speed multiplier (0.5 to 2.0)')
          .setRequired(true)
          .setMinValue(0.5)
          .setMaxValue(2.0)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const rate = interaction.options.getNumber('rate');
      
      await player.shoukaku.setFilters({
        timescale: { speed: rate, pitch: 1.0, rate: 1.0 }
      });
      
      return interaction.reply(`⏩ Set playback speed to **${rate}x**`);
    }
  },

  pitch: {
    data: new SlashCommandBuilder()
      .setName('pitch')
      .setDescription('Adjust audio pitch')
      .addNumberOption(option =>
        option.setName('level')
          .setDescription('Pitch multiplier (0.5 to 2.0)')
          .setRequired(true)
          .setMinValue(0.5)
          .setMaxValue(2.0)
      ),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      if (!player?.queue.current) {
        return interaction.reply({ content: 'Nothing is playing.', ephemeral: true });
      }
      
      const pitch = interaction.options.getNumber('level');
      
      await player.shoukaku.setFilters({
        timescale: { speed: 1.0, pitch: pitch, rate: 1.0 }
      });
      
      return interaction.reply(`🎵 Set pitch to **${pitch}x**`);
    }
  },

  filters: {
    data: new SlashCommandBuilder()
      .setName('filters')
      .setDescription('Show active filters and available presets'),

    async execute(interaction, client) {
      const player = client.kazagumo.players.get(interaction.guildId);
      
      const embed = new EmbedBuilder()
        .setTitle('🎛️ Audio Filters')
        .setColor('#5865F2');
      
      // Show active filters
      if (player?.data?.activeFilters?.size) {
        embed.addFields({
          name: '✅ Active Filters',
          value: [...player.data.activeFilters].join(', ') || 'None'
        });
      }
      
      // Show available presets
      const presetList = Object.keys(filterPresets)
        .map(p => `\`${p}\``)
        .join(', ');
      
      embed.addFields({
        name: '📋 Available Presets',
        value: presetList
      });
      
      embed.addFields({
        name: '📖 Usage',
        value: '`/filter <preset>` - Apply a filter\n`/clearfilter` - Remove all filters\n`/speed <0.5-2.0>` - Adjust speed\n`/pitch <0.5-2.0>` - Adjust pitch'
      });
      
      return interaction.reply({ embeds: [embed] });
    }
  }
};

module.exports = commands;
