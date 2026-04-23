import { Client, GatewayIntentBits, Events, WebhookClient } from 'discord.js';

const COLORS = {
  join: 0x57F287,   // green
  leave: 0xED4245,  // red
  death: 0x95A5A6,  // gray
  server_start: 0x57F287,
  server_stop: 0xED4245,
};

function avatarURL(player) {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export async function createDiscordBot({ token, channelId, webhookUrl, onMessage }) {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  await new Promise((resolve, reject) => {
    client.once(Events.ClientReady, resolve);
    client.once('error', reject);
    client.login(token).catch(reject);
  });

  console.log(`[Discord] Logged in as ${client.user.tag}`);

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    console.error(`[Discord] Channel ${channelId} not found.`);
    process.exit(1);
  }

  const webhook = new WebhookClient({ url: webhookUrl });

  // Discord -> Minecraft
  client.on(Events.MessageCreate, (msg) => {
    if (msg.channelId !== channelId) return;
    if (msg.author.bot) return;
    onMessage(msg.author.displayName ?? msg.author.username, msg.content);
  });

  async function sendEvent(event) {
    try {
      switch (event.type) {
        case 'chat':
          await webhook.send({
            username: event.player,
            avatarURL: avatarURL(event.player),
            content: event.message,
          });
          break;

        case 'join':
        case 'leave':
        case 'death':
          await webhook.send({
            username: event.player,
            avatarURL: avatarURL(event.player),
            embeds: [{
              description: event.type === 'death'
                ? event.message
                : `**${event.player}** ${event.type === 'join' ? 'joined' : 'left'} the server`,
              color: COLORS[event.type],
            }],
          });
          break;

        case 'server_start':
        case 'server_stop':
          await webhook.send({
            username: 'Server',
            embeds: [{
              description: event.type === 'server_start' ? 'Server is online' : 'Server is going offline',
              color: COLORS[event.type],
            }],
          });
          break;
      }
    } catch (err) {
      console.error('[Discord] Failed to send:', err.message);
    }
  }

  return { sendEvent };
}
