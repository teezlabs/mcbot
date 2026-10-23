// Pushes the @names to the mcdiscord server mod (mod/ in this repo), which offers them as Tab
// completions in chat. Without the mod this logs once per RCON connection and does nothing.
export function createCompletionSync(rcon) {
  let names = [];
  let modMissing = false;
  let queue = Promise.resolve();

  async function sync() {
    if (!rcon.connected || modMissing) return;
    const reply = await rcon.query('mcdiscord names clear');
    if (reply === null) return;
    if (!reply.startsWith('mcdiscord:')) {
      modMissing = true;
      console.warn('[Completions] mcdiscord mod not found on the server, so @name Tab completion is off');
      return;
    }
    for (const name of names) await rcon.send(`mcdiscord names add ${name}`);
    console.log(`[Completions] Sent ${names.length} names to the server`);
  }

  function schedule() {
    queue = queue.then(sync).catch((err) => console.error('[Completions] Sync failed:', err.message));
  }

  return {
    setNames(next) {
      names = next;
      schedule();
    },
    // The mod forgets the names when the server restarts, and may have been installed since
    resync() {
      modMissing = false;
      schedule();
    },
  };
}
