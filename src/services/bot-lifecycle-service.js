const DEFAULT_INTERVALS = {
  giveawayMs: 30_000,
  heartbeatMs: 24 * 60 * 60_000,
  uiMs: 60_000
};

export function createBotLifecycleService({
  client,
  guildId,
  keepSupabaseAwake,
  loadServiceStatuses,
  refreshInviteCache,
  ensureIntegrationAccess,
  refreshServerStats,
  refreshPanels,
  guildUiSnapshot,
  checkStoreStatusAnnouncement,
  refreshGuildUiIfChanged,
  endDueGiveaways,
  recordUiSnapshot,
  intervals = DEFAULT_INTERVALS,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  logger = console
}) {
  const timers = [];
  const running = new Set();
  let started = false;

  async function safely(label, task) {
    try {
      return await task();
    } catch (error) {
      logger.warn(`${label} failed:`, error.message);
      return null;
    }
  }

  async function runExclusive(key, task) {
    if (running.has(key)) return false;
    running.add(key);
    try {
      await task();
      return true;
    } finally {
      running.delete(key);
    }
  }

  async function fetchGuild() {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) logger.warn(`Configured Discord guild could not be fetched: ${guildId}`);
    return guild;
  }

  async function initialize() {
    await safely('Supabase heartbeat', keepSupabaseAwake);
    const guild = await fetchGuild();
    if (!guild) return null;

    await safely('Service status load', () => loadServiceStatuses(guild.id));
    await safely('Invite cache refresh', () => refreshInviteCache(guild));
    await safely('Integration permission sync', () => ensureIntegrationAccess(guild));
    await safely('Server stats refresh', () => refreshServerStats(guild));
    await safely('Panel refresh', () => refreshPanels(guild));
    recordUiSnapshot(guildUiSnapshot(guild.id));
    await safely('Store status announcement check', () => checkStoreStatusAnnouncement(guild));
    await safely('Giveaway auto-end', endDueGiveaways);
    return guild;
  }

  function schedule(key, intervalMs, task) {
    const timer = setIntervalFn(
      () => runExclusive(key, task).catch((error) => logger.error(`${key} scheduler failed:`, error)),
      intervalMs
    );
    timer?.unref?.();
    timers.push(timer);
  }

  function start() {
    if (started) return false;
    started = true;

    schedule('heartbeat', intervals.heartbeatMs, () => safely('Supabase heartbeat', keepSupabaseAwake));
    schedule('ui', intervals.uiMs, async () => {
      const guild = await fetchGuild();
      if (!guild) return;
      await safely('Store status announcement check', () => checkStoreStatusAnnouncement(guild));
      await safely('UI refresh check', () => refreshGuildUiIfChanged(guild));
    });
    schedule('giveaway', intervals.giveawayMs, () => safely('Giveaway auto-end', endDueGiveaways));
    return true;
  }

  function stop() {
    for (const timer of timers.splice(0)) clearIntervalFn(timer);
    running.clear();
    started = false;
  }

  return { initialize, start, stop };
}
