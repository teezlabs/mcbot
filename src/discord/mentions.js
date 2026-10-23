import { Events, PermissionFlagsBits } from 'discord.js';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Turns @Name in Minecraft chat into real pings, for members who can see the channel and roles that
// Discord marks as mentionable. @everyone and @here never ping. Needs the Server Members intent.
export async function createMentions(client, channel) {
  const guild = channel.guild;
  await guild.members.fetch();

  let targets = new Map();
  let pattern = null;
  let names = [];
  const listeners = [];

  function rebuild() {
    const next = new Map();
    const completions = new Set();
    const add = (name, target) => {
      if (name && !next.has(name.toLowerCase())) next.set(name.toLowerCase(), target);
    };

    const members = [...guild.members.cache.values()]
      .filter((m) => !m.user.bot && channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel));
    // Display names win over usernames when two people collide
    for (const m of members) add(m.displayName, { type: 'user', id: m.id });
    for (const m of members) add(m.user.username, { type: 'user', id: m.id });
    for (const m of members) completions.add(`@${m.displayName}`);

    for (const role of guild.roles.cache.values()) {
      if (!role.mentionable || role.id === guild.id) continue;
      add(role.name, { type: 'role', id: role.id });
      completions.add(`@${role.name}`);
    }

    targets = next;
    // Longest first, so @Big Steve wins over @Big
    const alternatives = [...next.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
    pattern = alternatives.length ? new RegExp(`(?<![\\p{L}\\p{N}_])@(${alternatives.join('|')})(?![\\p{L}\\p{N}_])`, 'giu') : null;

    const nextNames = [...completions].sort();
    if (nextNames.join('\n') !== names.join('\n')) {
      names = nextNames;
      for (const listener of listeners) listener(names);
    }
  }

  let timer = null;
  function scheduleRebuild(changedGuild) {
    if (changedGuild?.id !== guild.id || timer) return;
    timer = setTimeout(() => {
      timer = null;
      rebuild();
    }, 2_000);
  }

  for (const event of [Events.GuildMemberAdd, Events.GuildMemberUpdate, Events.GuildMemberRemove]) {
    client.on(event, (member) => scheduleRebuild(member.guild));
  }
  for (const event of [Events.GuildRoleCreate, Events.GuildRoleUpdate, Events.GuildRoleDelete]) {
    client.on(event, (role) => scheduleRebuild(role.guild));
  }
  // Permission overwrites decide who can see the channel
  client.on(Events.ChannelUpdate, (_, updated) => {
    if (updated.id === channel.id) scheduleRebuild(updated.guild);
  });

  rebuild();
  console.log(`[Mentions] ${names.length} names can be pinged from Minecraft`);

  return {
    resolve(text) {
      const users = new Set();
      const roles = new Set();
      const content = pattern
        ? text.replace(pattern, (match, name) => {
          const target = targets.get(name.toLowerCase());
          if (!target) return match;
          if (target.type === 'user') {
            users.add(target.id);
            return `<@${target.id}>`;
          }
          roles.add(target.id);
          return `<@&${target.id}>`;
        })
        : text;
      return { content, allowedMentions: { parse: [], users: [...users], roles: [...roles] } };
    },
    names: () => names,
    onNamesChange: (listener) => listeners.push(listener),
  };
}
