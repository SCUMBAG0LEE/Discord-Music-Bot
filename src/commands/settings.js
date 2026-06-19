import { Command, Declare, Options, SubCommand, Embed, createStringOption, createIntegerOption, createBooleanOption } from 'seyfert';
import { musicManager } from '../services/MusicManager.js';
import { loadSettings, setSetting } from '../services/serverSettings.js';
import { isDJ, djOnlyError } from '../utils/permissions.js';

const loopOptions = {
    mode: createStringOption({
        description: 'Loop mode',
        required: true,
        choices: [
            { name: 'Off', value: '0' },
            { name: 'Song', value: '1' },
            { name: 'Queue', value: '2' }
        ]
    })
};

@Declare({
    name: 'loop',
    description: 'Set loop mode for the current playback'
})
@Options(loopOptions)
export class LoopCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue) return ctx.write({ content: 'There is no music playing.', flags: 64 });
        
        const mode = parseInt(ctx.options.mode);
        queue.loopMode = mode;
        
        const modeText = mode === 0 ? 'Off' : mode === 1 ? 'Song' : 'Queue';
        await ctx.write({ content: `🔁 Loop mode set to: **${modeText}**` });
    }
}

@Declare({
    name: 'autoplay',
    description: 'Toggle autoplay (play related songs when queue ends)'
})
export class AutoplayCommand extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue) return ctx.write({ content: 'There is no music playing.', flags: 64 });
        
        queue.autoplay = !queue.autoplay;
        const status = queue.autoplay ? 'Enabled' : 'Disabled';
        await ctx.write({ content: `📻 Autoplay is now **${status}**` });
    }
}

@Declare({
    name: 'stay247',
    description: 'Toggle 24/7 mode (prevent bot from leaving when queue is empty)'
})
export class Stay247Command extends Command {
    async run(ctx) {
        const queue = musicManager.getQueue(ctx.guildId);
        if (!queue) return ctx.write({ content: 'I must be in a voice channel first. Play a song!', flags: 64 });
        
        queue.stay247 = !queue.stay247;
        const status = queue.stay247 ? 'Enabled' : 'Disabled';
        await ctx.write({ content: `🕒 24/7 Mode is now **${status}**` });
    }
}


const announceSubOptions = {
    enabled: createBooleanOption({
        description: 'Enable announcements',
        required: true
    })
};

@Declare({
    name: 'view',
    description: 'View current settings'
})
class SettingsViewSub extends SubCommand {
    async run(ctx) {
        const settings = await loadSettings(ctx.guildId);
        const queue = musicManager.getQueue(ctx.guildId);
        
        const announcements = settings.announceNowPlaying !== false ? 'Enabled' : 'Disabled';
        const loopMode = queue 
            ? (queue.loopMode === 1 ? 'Song' : queue.loopMode === 2 ? 'Queue' : 'Off') 
            : 'Off';
        const stay247 = queue 
            ? (queue.stay247 ? 'Enabled' : 'Disabled') 
            : (settings.stayInChannel ? 'Enabled' : 'Disabled');
        const autoplay = queue 
            ? (queue.autoplay ? 'Enabled' : 'Disabled') 
            : 'Disabled';

        const embed = new Embed()
            .setTitle('🎵 Music Settings')
            .setColor('#5865F2')
            .addFields([
                { name: '📢 Announcements', value: announcements, inline: true },
                { name: '🔁 Loop Mode', value: loopMode, inline: true },
                { name: '📻 24/7 Mode', value: stay247, inline: true },
                { name: '🔀 Autoplay', value: autoplay, inline: true }
            ])
            .setFooter({ text: 'Use /settings announcements to change settings' });

        return ctx.write({ embeds: [embed] });
    }
}


@Declare({
    name: 'announcements',
    description: 'Toggle now playing announcements'
})
@Options(announceSubOptions)
class SettingsAnnouncementsSub extends SubCommand {
    async run(ctx) {
        if (!await isDJ(ctx.member)) return djOnlyError(ctx);

        const enabled = ctx.options.enabled;
        await setSetting(ctx.guildId, 'announceNowPlaying', enabled);
        
        return ctx.write({ 
            content: enabled 
                ? '📢 Now playing announcements **enabled**' 
                : '🔇 Now playing announcements **disabled**' 
        });
    }
}

@Declare({
    name: 'settings',
    description: 'View or change music settings'
})
@Options([SettingsViewSub, SettingsAnnouncementsSub])
export class SettingsCommand extends Command {
    async run(ctx) {
        // Seyfert automatically routes to subcommands based on the interaction.
    }
}
