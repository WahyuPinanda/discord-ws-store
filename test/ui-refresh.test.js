import assert from 'node:assert/strict';
import test from 'node:test';
import { createUiRefreshService } from '../src/services/ui-refresh-service.js';

function nextImmediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('coalesces repeated UI refresh requests for the same guild', async () => {
  let statsRefreshes = 0;
  let panelRefreshes = 0;
  const snapshots = [];
  const guild = { id: 'guild-1' };
  const service = createUiRefreshService({
    refreshServerStats: async () => {
      statsRefreshes += 1;
    },
    refreshPanels: async () => {
      panelRefreshes += 1;
    },
    guildUiSnapshot: () => 'snapshot-1',
    onSnapshot: (snapshot) => snapshots.push(snapshot)
  });

  service.refreshGuildUiInBackground(guild, 'status one');
  service.refreshGuildUiInBackground(guild, 'status two');
  service.refreshPanelsInBackground(guild, 'manual panel');
  await nextImmediate();
  await nextImmediate();

  assert.equal(statsRefreshes, 1);
  assert.equal(panelRefreshes, 1);
  assert.deepEqual(snapshots, ['snapshot-1']);
});
