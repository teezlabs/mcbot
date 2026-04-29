import { Client, GatewayIntentBits, Events, WebhookClient, ActivityType, REST, Routes, SlashCommandBuilder } from 'discord.js';

const COLORS = {
  join: 0x57F287,   // green
  leave: 0xED4245,  // red
  death: 0x95A5A6,  // gray
  advancement: 0xF1C40F, // yellow
  server_start: 0x57F287,
  server_stop: 0xED4245,
};

const ADVANCEMENT_VERB = {
  'made the advancement': 'earned the advancement',
  'completed the challenge': 'completed the challenge',
  'reached the goal': 'reached the goal',
};

function avatarURL(player) {
  return `https://mc-heads.net/avatar/${player}/64`;
}

export async function createDiscordBot({ token, channelId, webhookUrl, onMessage, curseforgeProjectId, curseforgeApiKey, fetchLatestFile }) {
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

  // Register slash commands
  if (curseforgeProjectId && curseforgeApiKey) {
    const rest = new REST().setToken(token);
    const commands = [
      new SlashCommandBuilder()
        .setName('checkupdate')
        .setDescription('Check for the latest modpack update on CurseForge')
        .toJSON(),
    ];
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands })
      .then(() => console.log('[Discord] Slash commands registered'))
      .catch((err) => console.error('[Discord] Failed to register commands:', err.message));

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand() || interaction.commandName !== 'checkupdate') return;
      await interaction.deferReply();
      try {
        const file = await fetchLatestFile(curseforgeProjectId, curseforgeApiKey);
        if (!file) {
          await interaction.editReply('Could not fetch update info from CurseForge.');
          return;
        }
        await interaction.editReply({
          embeds: [{
            title: 'Latest modpack version',
            description: `**${file.displayName}**`,
            url: file.downloadUrl ?? undefined,
            color: 0xF0A500,
            timestamp: file.fileDate,
            footer: { text: 'Released' },
          }],
        });
      } catch (err) {
        await interaction.editReply('Failed to check for updates.');
        console.error('[Discord] /checkupdate error:', err.message);
      }
    });
  }

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

        case 'advancement':
          await webhook.send({
            username: event.player,
            avatarURL: avatarURL(event.player),
            embeds: [{
              description: `**${event.player}** ${ADVANCEMENT_VERB[event.kind] ?? event.kind} **[${event.name}]**`,
              color: COLORS.advancement,
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

  async function sendPackUpdate(file) {
    try {
      await webhook.send({
        username: 'Pack Updates',
        embeds: [{
          title: 'New modpack update available!',
          description: `**${file.displayName}** is now available on CurseForge.`,
          url: file.downloadUrl ?? undefined,
          color: 0xF0A500,
          timestamp: file.fileDate,
        }],
      });
    } catch (err) {
      console.error('[Discord] Failed to send pack update:', err.message);
    }
  }

  function updatePresence({ online, max, players, serverOnline, packName }) {
    if (!serverOnline) {
      client.user.setPresence({
        activities: [{ name: 'Server offline', type: ActivityType.Playing }],
        status: 'idle',
      });
      return;
    }
    const state = online === 0
      ? 'No players online'
      : players.join(', ');
    client.user.setPresence({
      activities: [{
        name: packName ? `${packName} • ${online}/${max} players` : `${online}/${max} players online`,
        type: ActivityType.Playing,
        state,
      }],
      status: online > 0 ? 'online' : 'idle',
    });
  }

  return { sendEvent, sendPackUpdate, updatePresence };
}
