export function createUiRefreshService({
  refreshServerStats,
  refreshPanels,
  guildUiSnapshot,
  onSnapshot,
  logger = console
}) {
  const queues = new Map();

  function schedule(guild, request, reason) {
    let state = queues.get(guild.id);
    if (!state) {
      state = { guild, stats: false, panels: false, reasons: new Set(), running: false };
      queues.set(guild.id, state);
    }

    state.stats ||= request.stats;
    state.panels ||= request.panels;
    state.reasons.add(reason);
    if (state.running) return;
    state.running = true;

    setImmediate(async () => {
      try {
        while (state.stats || state.panels) {
          const refreshStats = state.stats;
          const refreshPanelMessages = state.panels;
          const reasons = [...state.reasons].join(', ');
          state.stats = false;
          state.panels = false;
          state.reasons.clear();

          try {
            if (refreshStats) await refreshServerStats(state.guild);
            if (refreshPanelMessages) await refreshPanels(state.guild);
            onSnapshot(guildUiSnapshot(state.guild.id));
          } catch (error) {
            logger.warn(`${reasons || 'Background UI'} refresh failed:`, error.message);
          }
        }
      } finally {
        queues.delete(guild.id);
      }
    });
  }

  return {
    refreshGuildUiInBackground(guild, reason) {
      schedule(guild, { stats: true, panels: true }, reason);
    },
    refreshPanelsInBackground(guild, reason) {
      schedule(guild, { stats: false, panels: true }, reason);
    }
  };
}
