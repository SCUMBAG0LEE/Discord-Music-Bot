import { config } from "seyfert";

export default config.bot({
  token: process.env.BOT_TOKEN ?? "",
  locations: {
    base: "src",
    commands: "commands",
    components: "components"
  },
  intents: ["Guilds", "GuildMessages", "GuildVoiceStates", "MessageContent"]
});
