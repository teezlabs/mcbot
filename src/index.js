import 'dotenv/config';
import { createDiscordBot } from './discord/bot.js';
import { watchLogs } from './minecraft/logWatcher.js';
import { RconClient } from './minecraft/rcon.js';
import { startPackUpdateChecker } from './minecraft/packUpdater.js';

const {
  DISCORD_TOKEN,
  DISCORD_CHANNEL_ID,
  DISCORD_WEBHOOK_URL,
  MC_LOG_PATH,
  RCON_HOST = 'localhost',
  RCON_PORT = '25575',
  RCON_PASSWORD,
  CURSEFORGE_API_KEY,
  CURSEFORGE_PROJECT_ID,
  PACK_UPDATE_INTERVAL_MS = '3600000',
} = process.env;

const missing = ['DISCORD_TOKEN', 'DISCORD_CHANNEL_ID', 'DISCORD_WEBHOOK_URL', 'RCON_PASSWORD']
  .filter((k) => !process.env[k]);

if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const rcon = new RconClient({ host: RCON_HOST, port: RCON_PORT, password: RCON_PASSWORD });

const bot = await createDiscordBot({
  token: DISCORD_TOKEN,
  channelId: DISCORD_CHANNEL_ID,
  webhookUrl: DISCORD_WEBHOOK_URL,
  onMessage(username, content) {
    if (!content.trim()) return;
    const safeName = username.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const safeMsg = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 200);
    rcon.send(`tellraw @a [{"text":"[Discord] ","color":"blue"},{"text":"${safeName}","bold":true},{"text":": ${safeMsg}"}]`);
  },
});

await rcon.connect();

watchLogs(MC_LOG_PATH, (event) => bot.sendEvent(event));

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
