import fs from 'fs';
import path from 'path';
import yauzl from 'yauzl';

// Every death message the server can print comes from a `death.*` key in some en_us.json:
// vanilla's inside the Minecraft jar, modded ones inside each mod jar. Reading those templates
// covers vanilla and modded deaths exactly, with no keyword guessing.
const LANG_ENTRY = /^assets\/([^/]+)\/lang\/en_us\.json$/;
const NESTED_JAR = /^META-INF\/(?:jarjar|versions\/[^/]+)\/[^/]+\.jar$/;
const PLACEHOLDER = /%(?:(\d+)\$)?s|%%/g;
const MIN_LITERAL_CHARS = 4;
// Jars up to this size are read in one go, which is far faster than yauzl's per-entry reads
const MAX_BUFFERED_JAR = 64 * 1024 * 1024;

// Used only when the vanilla language file can't be found in the server folder
const DEATH_KEYWORDS = [
  'was slain', 'was shot', 'drowned', 'burned to death', 'fell from', 'fell off',
  'fell out of the world', 'blew up', 'was blown up', 'died', 'starved to death',
  'suffocated', 'was killed', 'hit the ground too hard', 'went up in flames',
  'walked into fire', 'was struck by lightning', 'experienced kinetic energy',
  'froze to death', 'was impaled', 'was skewered', 'was fireballed', 'was pummeled',
  'tried to swim in lava', 'was pricked to death', 'was squashed',
  'walked into a cactus', 'was squished too much', "was roasted in dragon's breath",
  'went off with a bang', 'was frozen to death', 'discovered the floor was lava',
  'walked into the danger zone', 'was burned to a crisp', "didn't want to live in the same world as",
  'left the confines of this world', 'was obliterated by a sonically-charged shriek',
  'was stung to death', 'was poked to death by a sweet berry bush', 'withered away',
  'fell while climbing', 'was doomed to fall', 'fell too far and was finished by',
];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "%1$s was slain by %2$s" -> /^(?<victim>\S+) was slain by .+$/
export function templateToRegex(template) {
  let re = '^';
  let last = 0;
  let next = 0;
  let hasVictim = false;
  for (const m of template.matchAll(PLACEHOLDER)) {
    re += escapeRe(template.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0] === '%%') { re += '%'; continue; }
    const arg = m[1] ? Number(m[1]) : ++next;
    if (arg === 1 && !hasVictim) {
      re += '(?<victim>\\S+)';
      hasVictim = true;
    } else {
      re += '.+';
    }
  }
  re += `${escapeRe(template.slice(last))}$`;
  const literal = template.replace(PLACEHOLDER, '').replace(/\s/g, '');
  if (!hasVictim || literal.length < MIN_LITERAL_CHARS) return null;
  return new RegExp(re);
}

function openZip(source) {
  return new Promise((resolve, reject) => {
    const done = (err, zip) => (err ? reject(err) : resolve(zip));
    if (Buffer.isBuffer(source)) yauzl.fromBuffer(source, { lazyEntries: true }, done);
    else yauzl.open(source, { lazyEntries: true }, done);
  });
}

function readEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  });
}

function addLang(buf, namespace, found) {
  let lang;
  try {
    lang = JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(lang)) {
    if (key.startsWith('death.') && typeof value === 'string') found.templates.add(value);
  }
  if (namespace === 'minecraft') found.hasVanilla = true;
}

async function scanZip(source, depth, found) {
  let zip;
  try {
    if (!Buffer.isBuffer(source) && fs.statSync(source).size <= MAX_BUFFERED_JAR) {
      source = await fs.promises.readFile(source);
    }
    zip = await openZip(source);
  } catch {
    return;
  }
  await new Promise((resolve) => {
    zip.on('entry', (entry) => {
      const lang = LANG_ENTRY.exec(entry.fileName);
      const nested = depth < 2 && NESTED_JAR.test(entry.fileName);
      if (!lang && !nested) return zip.readEntry();
      readEntry(zip, entry)
        .then((buf) => (lang ? addLang(buf, lang[1], found) : scanZip(buf, depth + 1, found)))
        .catch(() => {})
        .finally(() => zip.readEntry());
    });
    zip.on('end', resolve);
    zip.on('error', resolve);
    zip.readEntry();
  });
  zip.close();
}

function findJars(dir, recursive, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && recursive) findJars(p, true, out);
    else if (!e.isDirectory() && e.name.endsWith('.jar')) out.push(p);
  }
  return out;
}

export async function loadDeathTemplates(serverDir) {
  const jars = [
    ...findJars(serverDir, false),
    ...findJars(path.join(serverDir, 'mods'), false),
    ...findJars(path.join(serverDir, 'libraries'), true),
  ];
  const found = { templates: new Set(), hasVanilla: false };
  for (const jar of jars) await scanZip(jar, 0, found);
  return { jars: jars.length, ...found };
}

export function createDeathDetector(serverDir) {
  let matchers = [];
  let useKeywords = true;
  let online = null;
  let loading = null;

  async function load() {
    if (!serverDir) {
      console.warn('[DeathMessages] No server folder set, using keyword list');
      return;
    }
    try {
      const { jars, templates, hasVanilla } = await loadDeathTemplates(serverDir);
      matchers = [...templates].map(templateToRegex).filter(Boolean);
      useKeywords = !hasVanilla;
      console.log(`[DeathMessages] Loaded ${matchers.length} death messages from ${jars} jars in ${serverDir}`);
      if (!hasVanilla) console.warn('[DeathMessages] Vanilla language file not found, also using keyword list');
    } catch (err) {
      console.error('[DeathMessages] Failed to load, using keyword list:', err.message);
    }
  }

  function reload() {
    loading ??= load().finally(() => { loading = null; });
    return loading;
  }

  function match(content) {
    let victim = null;
    for (const re of matchers) {
      const m = re.exec(content);
      if (m) { victim = m.groups.victim; break; }
    }
    if (!victim && useKeywords && DEATH_KEYWORDS.some((kw) => content.includes(kw))) {
      victim = content.split(' ')[0];
    }
    if (victim && online && !online.has(victim)) return null;
    return victim;
  }

  return {
    reload,
    match,
    isOnline(player) { return online?.has(player) ?? false; },
    setOnlinePlayers(players) { online = new Set(players); },
    playerJoined(player) { online?.add(player); },
    playerLeft(player) { online?.delete(player); },
  };
}
