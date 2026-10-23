# MC-Discord Bridge

Bridges chat between a Minecraft server and Discord. Works with NeoForge 1.21.1 (and most other server types). Runs as a Docker container or directly with Node.js.

## What it does

- Minecraft chat shows up in Discord with the player's skin as the avatar
- `/say` messages from the console, RCON or players show up in Discord
- Discord messages show up in Minecraft chat
- Nothing from Minecraft can ping in Discord by default. With `DISCORD_MENTIONS=true`, `@Name` pings members who can see the channel and mentionable roles; `@everyone` and `@here` never ping
- With the optional server mod in `mod/`, players can type `@Te` and press Tab to complete Discord names in chat
- Join/leave, death and advancement messages are posted to Discord (deaths are matched against the server's own vanilla and modded death messages)
- Server start/stop is announced in Discord
- Modpack update notifications when a new version is released on CurseForge (optional)

## Requirements

- Docker, or Node.js 18+ (22 recommended) to run without Docker
- A Discord bot and webhook for the same channel
- RCON enabled on your Minecraft server

## Setup

**1. Enable RCON in `server.properties`:**
```
enable-rcon=true
rcon.port=25575
rcon.password=yourpassword
```

**2. Create a Discord bot:**
- Go to [discord.com/developers/applications](https://discord.com/developers/applications)
- New Application, then go to the Bot tab
- Copy the token
- Enable **Message Content Intent** under Privileged Gateway Intents
- Invite the bot to your server with Send Messages and Read Message History permissions

**3. Create a webhook:**
- In your Discord channel, go to Settings, Integrations, Webhooks
- Create a new webhook and copy the URL

**4. Configure:**
```bash
cp .env.example .env
```
Fill in all values in `.env`.

**5. Run:**
```bash
docker compose up -d
```

## Running without Docker

The bot is a plain Node.js app, so Docker is optional.

```bash
npm install
npm start
```

Differences from the Docker setup:

- Set `MC_LOG_PATH` in `.env` to the full path of `latest.log` (for example `/path/to/server/logs/latest.log`). `MC_LOG_HOST_DIR` is only used by Docker and can be left out.
- Set `RCON_HOST=localhost` if the bot runs on the same machine as the server.
- Use a process manager to keep the bot running. The bot exits on purpose if `latest.log` is missing or the channel ID is wrong; Docker restarts it automatically, but without Docker nothing will.

Example systemd service (`/etc/systemd/system/mc-discord.service`):

```ini
[Unit]
Description=MC-Discord bridge
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=/path/to/mcbot
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now mc-discord
journalctl -u mc-discord -f
```

pm2 works too: `pm2 start src/index.js --name mc-discord`.

## .env reference

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CHANNEL_ID` | Channel ID for all messages |
| `DISCORD_WEBHOOK_URL` | Webhook URL for the same channel |
| `MC_LOG_HOST_DIR` | Docker only. Path to the logs *directory* on the host machine (not `latest.log` itself — see note below) |
| `MC_LOG_PATH` | Without Docker only. Full path to `latest.log` (Docker sets this itself) |
| `MC_SERVER_HOST_DIR` | Docker only. Path to the server folder on the host. Mounted read-only so the bot can read death messages from the jars in `mods/` and `libraries/` |
| `MC_SERVER_DIR` | (Optional) Without Docker only. Server folder; defaults to the folder above `logs/` |
| `RCON_HOST` | RCON host (use `localhost` if server runs on the same machine) |
| `RCON_PORT` | RCON port (default 25575) |
| `RCON_PASSWORD` | RCON password |
| `CURSEFORGE_API_KEY` | (Optional) CurseForge API key — enables pack update notifications |
| `CURSEFORGE_PROJECT_ID` | (Optional) CurseForge project ID of the modpack |
| `PACK_UPDATE_INTERVAL_MS` | (Optional) How often to check for updates in ms (default: `3600000` = 1 hour) |
| `PACK_NAME` | (Optional) Name shown in the bot's status. Defaults to the CurseForge project name; works without a CurseForge key |
| `DISCORD_MENTIONS` | (Optional) `true` lets `@Name` in Minecraft chat ping Discord members and mentionable roles. Needs the **Server Members Intent** turned on in the developer portal |
| `AVATAR_URL` | (Optional) Avatar image for Minecraft messages. `{id}` becomes the player's UUID, or their name if the UUID isn't known yet (default: `https://minotar.net/helm/{id}/64.png`) |

## @name Tab completion (optional server mod)

With `DISCORD_MENTIONS=true`, the bot can also send the server the names players can ping. The small NeoForge 1.21.1 mod in `mod/` turns them into chat Tab completions: type `@Te`, press Tab, get `@Teez`. It is server-side only, so players don't need to install anything.

Download `mcdiscord-<version>.jar` from the [releases page](https://github.com/teezlabs/mcbot/releases), or with `gh release download mcdiscord-mod-v0.1.0 -R teezlabs/mcbot`. To build it yourself instead:

```bash
cd mod
./gradlew build          # needs JDK 21; the jar lands in build/libs/mcdiscord-<version>.jar
```

Copy the jar into the server's `mods/` folder and restart the server. The bot pushes the names over RCON (`mcdiscord names clear` / `mcdiscord names add <name>`) every time RCON connects and whenever members, nicknames or roles change. Without the mod, the bot logs one warning and pings still work.

> **Why the directory?** Bind-mounting a single file pins its inode in the container. When Minecraft rotates `latest.log`, the container keeps tailing the old (now archived) file and stops seeing new messages. Mounting the directory makes rotation transparent.
