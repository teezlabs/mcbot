# CLAUDE.md

This file guides Claude Code when it works in this repository.

## What this is

This bot connects a Minecraft server's chat with a Discord channel, a GameVox channel, or both. It runs on its own, outside the server, either in Docker or directly with Node. It was built for **1.21.1 NeoForge**, where the MC2Discord mod doesn't work, but it should work with most server types. The Minecraft server is expected to run on the same machine, not inside Docker.

Features:

- Minecraft chat, joins and leaves, deaths and advancements are posted to Discord, with the player's skin as the avatar
- `/say` messages from the console, RCON or players are posted too
- Discord messages appear in Minecraft chat
- The server going online or offline is announced in Discord
- The bot's Discord presence shows the pack name, the player count and who is online
- Optional CurseForge modpack update notifications and a `/checkupdate` slash command
- Optional GameVox support (`GAMEVOX_TOKEN`), alongside Discord or instead of it
- Optional `@Name` pings from Minecraft (`DISCORD_MENTIONS=true`), plus Tab completion of those names through the server mod in `mod/`

## How it works

```
MC server ──writes──> logs/latest.log ──tailed by──> bot ──webhook──> Discord channel
MC server <──RCON tellraw / list── bot <──discord.js gateway── Discord channel
```

- **MC → Discord:** the bot follows the server's `logs/latest.log` as it grows. The whole `logs/` directory is bind-mounted read-only into the container. The bot turns each relevant line into an event and posts it through a **Discord webhook**, so each message shows the player's name and their face as the avatar. The image comes from Minotar by default, requested by UUID; `AVATAR_URL` overrides it. mc-heads.net, the old default, now returns the default Steve head for players with custom skins.
- **Discord → MC:** a discord.js v14 bot reads messages in one channel and sends them into the game with RCON `tellraw @a`, shown as `[DISCORD] <Name> msg` (bold blue tag, then the name and message in white, like vanilla chat). Pings, role and channel mentions and custom emoji are converted to readable text with `cleanContent`.
- **Mentions (optional):** with `DISCORD_MENTIONS=true` the bot asks for the privileged Server Members intent. `mentions.js` keeps a map of display names, usernames and mentionable role names, limited to members who can see the channel. It rewrites `@Name` in chat and `/say` text into `<@id>` / `<@&id>` and allows exactly those IDs in `allowedMentions`. Everything else stays non-pinging (`parse: []`).
- **Tab completion (optional):** `completions.js` sends the `@names` to the `mcdiscord` mod over RCON (`mcdiscord names clear`, then `mcdiscord names add <name>`) on every RCON connect and when the list changes. The mod sends them to players as vanilla custom chat completions (`ClientboundCustomChatCompletionsPacket`). A reply that doesn't start with `mcdiscord:` means the mod isn't installed.
- **GameVox (optional):** GameVox runs a Discord-compatible bot API. `createDiscordBot()` is called a second time with `api` / `gatewayURL` pointing discord.js at `app-api.gamevox.com` and `gateway.gamevox.com`. GameVox webhooks always post as the bot (no `username` / `avatarURL` overrides), so this instance has no webhook: `post()` sends through `channel.send` and puts the player's name and head in the embed's `author`. In game it shows as `[GAMEVOX]` in gold. Mentions and Tab completion stay Discord-only, because the mod keeps a single name list. `index.js` fans every event out to all configured bots. Docs: developers.gamevox.com/docs (the feature matrix and self-hosted pages list what's missing)
- **Server status:** every 30s, `index.js` runs RCON `list`. The result updates the bot's presence. A change between online and offline triggers a `server_start` or `server_stop` event. Server status doesn't come from log lines.
- **Pack updates (optional):** `packUpdater.js` polls the CurseForge API. The first check only records the current file. After that, a new file ID posts an update embed.
- The container uses the `node:22-alpine` image and `network_mode: host`, so RCON on `localhost:25575` reaches the server on the host.

### Files

| File | Purpose |
|---|---|
| `src/index.js` | Entry point. Checks environment variables and connects the parts. Builds the `tellraw` text component with `JSON.stringify`, polls presence and status with RCON `list`, and starts the pack checker |
| `src/discord/bot.js` | discord.js client that reads the channel, plus a `WebhookClient` that posts to it (or `channel.send` with embed authors when there's no webhook, as on GameVox). Used for both Discord and GameVox. Exports `sendEvent()`, `sendPackUpdate()` and `updatePresence()`, and registers `/checkupdate` when CurseForge is configured |
| `src/minecraft/logWatcher.js` | Follows the log with the `tail` package, polling the file via `useWatchFile`. Restarts the tail after errors. `parseLine()` turns lines into events |
| `src/minecraft/deathMessages.js` | Reads every `death.*` template from the `en_us.json` files in the server's jars (top level, `mods/`, `libraries/`, and nested `META-INF/jarjar` / `META-INF/versions` jars) and turns each into a regex. Only accepts deaths of players who are online. Falls back to a keyword list if the vanilla language file isn't found. Reloads when the server comes back online |
| `src/minecraft/playerUuids.js` | Remembers each player's UUID from "UUID of player X is Y" log lines and the server's `usercache.json`, so avatars are requested by UUID, which avatar services resolve more reliably than names |
| `src/minecraft/rcon.js` | Wrapper around `rcon-client` that reconnects every 10s. `send()` ignores the server's response, `query()` returns it, `connected` reports the connection state, and `onConnect` runs after each (re)connect |
| `src/discord/mentions.js` | Resolves `@Name` to Discord user and role mentions and tracks the list of pingable names |
| `src/minecraft/completions.js` | Pushes the pingable names to the `mcdiscord` server mod over RCON |
| `mod/` | Server-side NeoForge 1.21.1 mod (Gradle, ModDevGradle, JDK 21). Adds the `/mcdiscord names` command and sends the names to players as chat completions. `./gradlew runServer` starts a dev server |
| `src/minecraft/packUpdater.js` | Calls the CurseForge API: `fetchPackName`, `fetchLatestFile` and `startPackUpdateChecker` |
| `docker-compose.yml` | One service on the host network. Mounts `${MC_LOG_HOST_DIR}` → `/mc/logs:ro` and `${MC_SERVER_HOST_DIR}` → `/mc/server:ro`, and sets `MC_LOG_PATH` and `MC_SERVER_DIR` to match |
| `.env.example` | Config template. Copy it to `.env`, which git ignores |

### Log format

NeoForge 1.21.x lines look like this:

```
[23Apr2026 01:16:42.176] [Server thread/INFO] [net.minecraft.server.MinecraftServer/]: <Player> message
```

The timestamp includes the date and milliseconds, and there are **three** bracket groups before the colon. `LINE_RE` in `logWatcher.js` matches this pattern, and only lines from the `MinecraftServer` logger are used. A chat-formatting mod or a different server type can change the format and break the `<Name> msg` match. Check real lines in the server's `logs/latest.log` before you change the regex.

Log events:

- `chat` (also "[Not Secure] <Name> msg", how 1.19+ logs unsigned chat)
- `join` ("joined the game")
- `leave` ("left the game")
- `death` (matched against the death-message templates from the server's language files; the victim must be an online player)
- `advancement` ("has made the advancement / completed the challenge / reached the goal [X]")
- `say` ("[Rcon] msg", "[Server] msg", or "[Player] msg" from an online player). Mods log status lines in the same format, such as "[Chunky] Task running...", so other senders are ignored

### Why the directory is mounted

Bind-mounting the single file `latest.log` locks the container to that one file. When Minecraft archives the log and starts a new one, the bot would keep reading the old file and go silent. Mounting the directory avoids that. Don't switch back to a file mount.

## Setup

1. In the server's `server.properties`, set `enable-rcon=true`, `rcon.port=25575` and `rcon.password=...`. Restart the server after changing these.
2. In this repo, run `cp .env.example .env` and fill it in:
   - `DISCORD_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_URL`. The webhook must belong to the **same** channel.
   - `MC_LOG_HOST_DIR`: the absolute path to `<server folder>/logs`. Use the directory, not the file.
   - `MC_SERVER_HOST_DIR`: the absolute path to the server folder. It's mounted read-only so the bot can read death messages from the jars.
   - `RCON_HOST=localhost` (the example's `host-gateway` is wrong; see known issues). Set `RCON_PORT` and `RCON_PASSWORD` to match `server.properties`.
   - Optional: `CURSEFORGE_API_KEY`, `CURSEFORGE_PROJECT_ID` and `PACK_UPDATE_INTERVAL_MS` (default 1 hour).
   - Optional: `PACK_NAME`, the name shown in the bot's status. It overrides the CurseForge project name and works without a key.
3. In the Discord developer portal, enable the **Message Content Intent** for the bot. In the channel, give it Send Messages and Read Message History.
4. Run `docker compose up -d --build`, then `docker compose logs -f`.
   - A healthy startup prints `[Discord] Logged in as ...`, then `[RCON] Connected`, then `[LogWatcher] Watching /mc/logs/latest.log`, then `[DeathMessages] Loaded N death messages ...`. N should be at least 99, the vanilla count for 1.21.1.
   - If `latest.log` doesn't exist yet or the channel ID is wrong, the container exits and Docker restarts it.

### Running without Docker

Docker is optional. The bot is a plain Node app (Node 18+ is required for built-in `fetch`; 22 matches the Docker image):

```bash
npm install
npm start        # or: npm run dev (restarts on file changes)
```

- `MC_LOG_PATH` must be set in `.env` to the full path of `latest.log`. Compose sets it inside Docker, so it isn't in `.env.example`. `MC_LOG_HOST_DIR` is only used by compose.
- `dotenv` loads `.env` from the working directory, so start the bot from the repo root.
- Without Docker, nothing restarts the bot after it exits on purpose (missing log file, bad channel ID). Use systemd or pm2; the README has a sample systemd unit.
- Log rotation isn't a problem here. `tail` reads the real file and follows the rename itself.

## Known issues / next work

These were found by reading the code and haven't been confirmed against a live server.

1. **`.env.example` sets `RCON_HOST=host-gateway`.** That name doesn't resolve under `network_mode: host`. It should be `localhost`, which is what the README says.
2. **Messages that are only attachments, stickers or embeds** have empty text and are silently dropped. Consider sending `[attachment]` instead.
3. **Player names are taken to be one word.** Death templates capture the victim as `\S+`, and joins and leaves use the first word of the line. A mod that adds prefixes or spaces to display names would break all three.
4. **The pack checker keeps the last-seen version only in memory.** A release that comes out while the bot is down is never announced.
5. **The `list` regex in `index.js`** expects the vanilla wording. A server or mod that changes it will make the bot report the server as permanently offline.
7. There are no tests and no linter.

## Conventions

- The code is ESM (`"type": "module"`) on Node 22, with 2-space indents, small modules and few comments. Match the existing style.
- Never commit `.env`. It holds the bot token, the RCON password and the CurseForge key.
