import 'dotenv/config';
import path from 'path';
import { createDiscordBot } from './discord/bot.js';
import { watchLogs } from './minecraft/logWatcher.js';
import { RconClient } from './minecraft/rcon.js';
import { createDeathDetector } from './minecraft/deathMessages.js';
import { createCompletionSync } from './minecraft/completions.js';
import { startPackUpdateChecker, fetchPackName, fetchLatestFile } from './minecraft/packUpdater.js';

const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  DISCORD_WEBHOOK_URL,
  MC_LOG_PATH,
  MC_SERVER_DIR,
  RCON_HOST = 'localhost',
  RCON_PORT = '25575',
  RCON_PASSWORD,
  CURSEFORGE_API_KEY,
  CURSEFORGE_PROJECT_ID,
  PACK_UPDATE_INTERVAL_MS = '3600000',
  DISCORD_MENTIONS,
} = process.env;

const missing = ['DISCORD_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_WEBHOOK_URL', 'RCON_PASSWORD']
  .filter((k) => !process.env[k]);

if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const rcon = new RconClient({
  host: RCON_HOST,
  port: RCON_PORT,
  password: RCON_PASSWORD,
  onConnect: () => completions.resync(),
});
const completions = createCompletionSync(rcon);

const bot = await createDiscordBot({
  token: DISCORD_TOKEN,
  channelId: DISCORD_CHANNEL_ID,
  webhookUrl: DISCORD_WEBHOOK_URL,
  mentionsEnabled: DISCORD_MENTIONS === 'true',
  onMentionNames: (names) => completions.setNames(names),
  curseforgeProjectId: CURSEFORGE_PROJECT_ID,
  curseforgeApiKey: CURSEFORGE_API_KEY,
  fetchLatestFile,
  onMessage(username, content) {
    if (!content.trim()) return;
    // JSON.stringify escapes line breaks and control characters, which used to make the command invalid
    // Vanilla-style line: [DISCORD] <Name> message. The leading '' keeps the parts from inheriting each other's style
    rcon.send(`tellraw @a ${JSON.stringify([
      '',
      { text: '[DISCORD] ', color: 'blue', bold: true },
      { text: `<${username}> ${content.slice(0, 200)}`, color: 'white' },
    ])}`);
  },
});

await rcon.connect();

const packName = process.env.PACK_NAME || (CURSEFORGE_API_KEY && CURSEFORGE_PROJECT_ID
  ? await fetchPackName(CURSEFORGE_PROJECT_ID, CURSEFORGE_API_KEY)
  : null);
if (packName) console.log(`[PackUpdater] Pack name: ${packName}`);

// Defaults to the folder above logs/, which is the server folder when running without Docker
const deaths = createDeathDetector(MC_SERVER_DIR || (MC_LOG_PATH && path.resolve(path.dirname(MC_LOG_PATH), '..')));
deaths.reload();

watchLogs(MC_LOG_PATH, (event) => bot.sendEvent(event), deaths);

let lastKnownOnline;

async function refreshPresence() {
  let isOnline = false;

  if (!rcon.connected) {
    bot.updatePresence({ serverOnline: false });
  } else {
    const response = await rcon.query('list');
    const match = response?.match(/There are (\d+) of a max(?: of)? (\d+) players online[^:]*:(.*)/);
    if (match) {
      const players = match[3].split(',').map((p) => p.trim()).filter(Boolean);
      bot.updatePresence({ online: Number(match[1]), max: Number(match[2]), players, serverOnline: true, packName });
      deaths.setOnlinePlayers(players);
      isOnline = true;
    } else {
      bot.updatePresence({ serverOnline: false });
    }
  }

  if (lastKnownOnline !== undefined && lastKnownOnline !== isOnline) {
    bot.sendEvent({ type: isOnline ? 'server_start' : 'server_stop' });
    // Mods may have been added or updated while the server was down
    if (isOnline) deaths.reload();
  }
  lastKnownOnline = isOnline;
}

await refreshPresence();
setInterval(refreshPresence, 30_000);

if (CURSEFORGE_API_KEY && CURSEFORGE_PROJECT_ID) {
  startPackUpdateChecker({
    projectId: CURSEFORGE_PROJECT_ID,
    apiKey: CURSEFORGE_API_KEY,
    intervalMs: Number(PACK_UPDATE_INTERVAL_MS),
    onUpdate: (file) => bot.sendPackUpdate(file),
  });
} else {
  console.log('[PackUpdater] Skipping — CURSEFORGE_API_KEY or CURSEFORGE_PROJECT_ID not set.');
}

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});
