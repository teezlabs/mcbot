const CURSEFORGE_API = 'https://api.curseforge.com/v1';

export async function fetchPackName(projectId, apiKey) {
  try {
    const res = await fetch(`${CURSEFORGE_API}/mods/${projectId}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data?.name ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestFile(projectId, apiKey) {
  const res = await fetch(
    `${CURSEFORGE_API}/mods/${projectId}/files?pageSize=1&sortField=5&sortOrder=desc`,
    { headers: { 'x-api-key': apiKey, Accept: 'application/json' } },
  );
  if (!res.ok) throw new Error(`CurseForge API ${res.status}`);
  const { data } = await res.json();
  return data?.[0] ?? null;
}

export async function startPackUpdateChecker({ projectId, apiKey, intervalMs = 3_600_000, onUpdate }) {
  let knownFileId = null;

  async function check() {
    try {
      const file = await fetchLatestFile(projectId, apiKey);
      if (!file) return;

      if (knownFileId === null) {
        // First run — just record current version, don't fire onUpdate
        knownFileId = file.id;
        console.log(`[PackUpdater] Tracking ${file.displayName} (file ${file.id})`);
        return;
      }

      if (file.id !== knownFileId) {
        knownFileId = file.id;
        onUpdate(file);
      }
    } catch (err) {
      console.error('[PackUpdater] Check failed:', err.message);
    }
  }

  await check();
  setInterval(check, intervalMs);
}
