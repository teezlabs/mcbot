import fs from 'fs';
import path from 'path';

// Avatar services resolve UUIDs far more reliably than names, so remember each player's UUID.
// They come from "UUID of player X is Y" log lines, and from the server's usercache.json for
// players who joined before the bot started.
const uuids = new Map();
let cacheMtime = 0;

function cacheFile() {
  const { MC_SERVER_DIR, MC_LOG_PATH } = process.env;
  const dir = MC_SERVER_DIR || (MC_LOG_PATH && path.resolve(path.dirname(MC_LOG_PATH), '..'));
  return dir && path.join(dir, 'usercache.json');
}

// Offline-mode servers use version 3 UUIDs, which have no skin, so the name works better there
function isOnlineUuid(id) {
  return /^[0-9a-f]{12}4[0-9a-f]{19}$/.test(id);
}

function add(name, uuid, overwrite) {
  const id = uuid.replace(/-/g, '').toLowerCase();
  const key = name.toLowerCase();
  if (!isOnlineUuid(id) || (!overwrite && uuids.has(key))) return;
  uuids.set(key, id);
}

function loadUserCache() {
  const file = cacheFile();
  if (!file) return;
  try {
    const { mtimeMs } = fs.statSync(file);
    if (mtimeMs === cacheMtime) return;
    cacheMtime = mtimeMs;
    for (const entry of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      if (entry?.name && entry?.uuid) add(entry.name, entry.uuid, false);
    }
  } catch {}
}

export function rememberUuid(name, uuid) {
  add(name, uuid, true);
}

export function uuidFor(name) {
  const key = name.toLowerCase();
  if (!uuids.has(key)) loadUserCache();
  return uuids.get(key) ?? null;
}
