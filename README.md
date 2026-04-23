# MC-Discord Bridge

Bridges chat between a Minecraft server and Discord. Works with NeoForge 1.21.1 (and most other server types). Runs as a Docker container.

## What it does

- Minecraft chat shows up in Discord with the player's skin as the avatar
- Discord messages show up in Minecraft chat
- Join/leave and death messages are posted to Discord
- Server start/stop is announced in Discord

## Requirements

- Docker
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

## .env reference

| Variable | Description |
|---|---|
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CHANNEL_ID` | Channel ID for all messages |
| `DISCORD_WEBHOOK_URL` | Webhook URL for the same channel |
| `MC_LOG_HOST_PATH` | Path to `latest.log` on the host machine |
| `RCON_HOST` | RCON host (use `localhost` if server runs on the same machine) |
| `RCON_PORT` | RCON port (default 25575) |
| `RCON_PASSWORD` | RCON password |
