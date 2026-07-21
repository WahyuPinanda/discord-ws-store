import assert from 'node:assert/strict';
import test from 'node:test';

import { createBotLifecycleService } from '../src/services/bot-lifecycle-service.js';

function createLifecycleContext() {
  const calls = [];
  const timers = [];
  const cleared = [];
  const guild = { id: 'guild-1' };
  const record = (name, result) => async () => {
    calls.push(name);
    return result;
  };
  const lifecycle = createBotLifecycleService({
    client: { guilds: { fetch: async () => guild } },
    guildId: guild.id,
    keepSupabaseAwake: record('heartbeat'),
    loadServiceStatuses: record('statuses'),
    refreshInviteCache: record('invites'),
    ensureIntegrationAccess: record('integrations'),
    refreshServerStats: record('stats'),
    refreshPanels: record('panels'),
    guildUiSnapshot: () => 'snapshot-1',
    checkStoreStatusAnnouncement: record('announcement'),
    refreshGuildUiIfChanged: record('ui'),
    endDueGiveaways: record('giveaways'),
    recordUiSnapshot: (snapshot) => calls.push(`snapshot:${snapshot}`),
    intervals: { heartbeatMs: 10, uiMs: 20, giveawayMs: 30 },
    setIntervalFn: (callback, ms) => {
      const timer = { callback, ms, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearIntervalFn: (timer) => cleared.push(timer),
    logger: { warn() {}, error() {} }
  });

  return { calls, cleared, lifecycle, timers };
}

test('bot lifecycle initializes dependencies in order and records the UI state', async () => {
  const { calls, lifecycle } = createLifecycleContext();

  await lifecycle.initialize();

  assert.deepEqual(calls, [
    'heartbeat',
    'statuses',
    'invites',
    'integrations',
    'stats',
    'panels',
    'snapshot:snapshot-1',
    'announcement',
    'giveaways'
  ]);
});

test('bot lifecycle starts once and clears every timer on stop', () => {
  const { cleared, lifecycle, timers } = createLifecycleContext();

  assert.equal(lifecycle.start(), true);
  assert.equal(lifecycle.start(), false);
  assert.deepEqual(timers.map((timer) => timer.ms), [10, 20, 30]);

  lifecycle.stop();
  assert.deepEqual(cleared, timers);
});

test('bot lifecycle does not overlap repeated scheduler ticks', async () => {
  const calls = [];
  const timers = [];
  let finishUiRefresh;
  const guild = { id: 'guild-1' };
  const lifecycle = createBotLifecycleService({
    client: { guilds: { fetch: async () => guild } },
    guildId: guild.id,
    keepSupabaseAwake: async () => {},
    loadServiceStatuses: async () => {},
    refreshInviteCache: async () => {},
    ensureIntegrationAccess: async () => {},
    refreshServerStats: async () => {},
    refreshPanels: async () => {},
    guildUiSnapshot: () => 'snapshot-1',
    checkStoreStatusAnnouncement: async () => {},
    refreshGuildUiIfChanged: async () => {
      calls.push('ui');
      await new Promise((resolve) => {
        finishUiRefresh = resolve;
      });
    },
    endDueGiveaways: async () => {},
    recordUiSnapshot: () => {},
    intervals: { heartbeatMs: 10, uiMs: 20, giveawayMs: 30 },
    setIntervalFn: (callback, ms) => {
      const timer = { callback, ms, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearIntervalFn: () => {},
    logger: { warn() {}, error() {} }
  });

  lifecycle.start();
  const firstTick = timers[1].callback();
  await new Promise((resolve) => setImmediate(resolve));
  const secondTick = timers[1].callback();

  await secondTick;
  assert.deepEqual(calls, ['ui']);

  finishUiRefresh();
  await firstTick;
});
