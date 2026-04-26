import { Tail } from 'tail';
import fs from 'fs';

// Matches any NeoForge INFO line and captures [logger] and message
const LINE_RE = /^\[[^\]]+\] \[[^\]]+\/INFO\] \[([^\]]+)\]: (.+)$/;

const DEATH_KEYWORDS = [
  'was slain', 'was shot', 'drowned', 'burned to death', 'fell from', 'fell off',
  'fell out of the world', 'blew up', 'was blown up', 'died', 'starved to death',
  'suffocated', 'was killed', 'hit the ground too hard', 'went up in flames',
  'walked into fire', 'was struck by lightning', 'experienced kinetic energy',
  'froze to death', 'was impaled', 'was skewered', 'was fireballed', 'was pummeled',
  'tried to swim in lava', 'was pricked to death', 'was squashed',
];

function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const [, logger, content] = m;

  // Only care about the main server logger for game events
  if (!logger.includes('MinecraftServer') && !logger.includes('minecraft/MinecraftServer')) return null;

  if (content.startsWith('<')) {
    const chat = /^<([^>]+)> (.+)$/.exec(content);
    if (chat) return { type: 'chat', player: chat[1], message: chat[2] };
  }

  if (content.endsWith('joined the game')) {
    return { type: 'join', player: content.split(' ')[0] };
  }

  if (content.endsWith('left the game')) {
    return { type: 'leave', player: content.split(' ')[0] };
  }

  if (DEATH_KEYWORDS.some((kw) => content.includes(kw))) {
    return { type: 'death', player: content.split(' ')[0], message: content };
  }

  if (/^Done \([\d.]+s\)!/.test(content)) {
    return { type: 'server_start' };
  }

  if (content === 'Stopping the server') {
    return { type: 'server_stop' };
  }

  return null;
}

export function watchLogs(logPath, onEvent) {
  if (!fs.existsSync(logPath)) {
    console.error(`[LogWatcher] Log file not found: ${logPath}`);
    process.exit(1);
  }

  const tail = new Tail(logPath, { follow: true, fromBeginning: false });

  tail.on('line', (line) => {
    const event = parseLine(line);
    if (event) onEvent(event);
  });

  tail.on('error', (err) => console.error('[LogWatcher] Error:', err));

  console.log(`[LogWatcher] Watching ${logPath}`);
  return tail;
}
