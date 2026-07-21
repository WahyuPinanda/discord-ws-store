import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoosterRoleService } from '../src/services/booster-role-service.js';

function createMember({ premiumSince = null, hasRole = false, calls = [] } = {}) {
  const role = { id: 'booster-role', name: 'Server Booster' };
  const member = {
    premiumSince,
    guild: {
      roles: {
        cache: {
          find: (callback) => callback(role) ? role : null
        }
      }
    },
    roles: {
      cache: {
        has: () => hasRole
      },
      add: async (addedRole) => calls.push(['add', addedRole.id]),
      remove: async (removedRole) => calls.push(['remove', removedRole.id])
    }
  };
  return { calls, member };
}

test('booster role service grants the configured role when a member starts boosting', async () => {
  const { calls, member } = createMember({ premiumSince: new Date('2026-07-21T00:00:00Z') });
  const service = createBoosterRoleService({ boosterRoleName: 'Server Booster' });

  assert.equal(await service.syncBoosterRoleForMember(member), true);
  assert.deepEqual(calls, [['add', 'booster-role']]);
});

test('booster role service removes the configured role when a member stops boosting', async () => {
  const { calls, member } = createMember({ hasRole: true });
  const service = createBoosterRoleService({ boosterRoleName: 'Server Booster' });

  assert.equal(await service.syncBoosterRoleForMember(member), true);
  assert.deepEqual(calls, [['remove', 'booster-role']]);
});

test('booster role service only syncs when the boost state changes', async () => {
  const { calls, member } = createMember({ premiumSince: new Date('2026-07-21T00:00:00Z') });
  const service = createBoosterRoleService({ boosterRoleName: 'Server Booster' });

  assert.equal(await service.handleGuildMemberUpdate(member, member), false);
  assert.deepEqual(calls, []);
});
