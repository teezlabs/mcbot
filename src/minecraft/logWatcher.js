import { Tail } from 'tail';
import fs from 'fs';
import { rememberUuid } from './playerUuids.js';

// Matches any NeoForge INFO line and captures [logger] and message
const LINE_RE = /^\[[^\]]+\] \[[^\]]+\/INFO\] \[([^\]]+)\]: (.+)$/;

export function parseLine(line, deaths) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, logger, content] = m;

  // Logged by the login thread, so it comes before the logger check
  const login = /^UUID of player (\S+) is ([0-9a-fA-F-]{32,36})$/.exec(content);
  if (login) return { type: 'uuid', player: login[1], uuid: login[2] };

  // Only care about the main server logger for game events
  if (!logger.includes('MinecraftServer') && !logger.includes('minecraft/MinecraftServer')) return null;

  // Unsigned chat is logged as "[Not Secure] <Player> msg" on 1.19+
  const text = content.replace(/^\[Not Secure\] /, '');

  if (text.startsWith('<')) {
    const chat = /^<([^>]+)> (.+)$/.exec(text);
    if (chat) return { type: 'chat', player: chat[1], message: chat[2] };
  }

  // /say from RCON, the console or a player: "[Rcon] msg", "[Server] msg", "[Player] msg".
  // No ':' or '[' in the sender, so command feedback like "[Player: Gave 1 [Diamond] to X]" is skipped.
  // Mods log status the same way ("[Chunky] Task running..."), so a player sender must be online
  const say = /^\[([^\[\]:]+)\] (.+)$/.exec(text);
  if (say && (say[1] === 'Rcon' || say[1] === 'Server' || deaths.isOnline(say[1]))) {
    return { type: 'say', sender: say[1], message: say[2] };
  }

  if (content.endsWith('joined the game')) {
    return { type: 'join', player: content.split(' ')[0] };
  }

  if (content.endsWith('left the game')) {
    return { type: 'leave', player: content.split(' ')[0] };
  }

  const advancement = /^(\S+) has (made the advancement|completed the challenge|reached the goal) \[(.+)\]$/.exec(content);
  if (advancement) {
    return { type: 'advancement', player: advancement[1], kind: advancement[2], name: advancement[3] };
  }

  const victim = deaths.match(content);
  if (victim) {
    return { type: 'death', player: victim, message: content };
  }

  return null;
}

export function watchLogs(logPath, onEvent, deaths) {
  if (!fs.existsSync(logPath)) {
    console.error(`[LogWatcher] Log file not found: ${logPath}`);
    process.exit(1);
  }

  let tail = null;

  function start() {
    tail = new Tail(logPath, {
      follow: true,
      fromBeginning: false,
      useWatchFile: true,
      fsWatchOptions: { interval: 1000 },
    });

    tail.on('line', (line) => {
      const event = parseLine(line, deaths);
      if (!event) return;
      if (event.type === 'uuid') return rememberUuid(event.player, event.uuid);
      if (event.type === 'join') deaths.playerJoined(event.player);
      if (event.type === 'leave') deaths.playerLeft(event.player);
      onEvent(event);
    });

    tail.on('error', (err) => {
      console.error('[LogWatcher] Error, restarting tail:', err.message);
      restart();
    });

    console.log(`[LogWatcher] Watching ${logPath}`);
  }

  function restart() {
    try { tail?.unwatch(); } catch {}
    setTimeout(start, 2000);
  }

  start();
  return { stop: () => tail?.unwatch() };
}
