import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionsBitField } from 'discord.js';

import {
  ensureBotDisplayRole,
  ensureRole,
  ensureRoleStackAbove
} from '../src/services/discord-resource-service.js';

function roleCache(roles) {
  return { find: (callback) => roles.find(callback) || null };
}

test('ensureRole reconciles settings on an existing role', async () => {
  const role = {
    name: 'Content Creator',
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(),
    async edit(changes) {
      this.editedWith = changes;
      Object.assign(this, changes);
      return this;
    }
  };
  const guild = { roles: { cache: roleCache([role]) } };

  const result = await ensureRole(guild, 'Content Creator', {
    color: 0x9b59b6,
    hoist: true,
    mentionable: true,
    permissions: [PermissionsBitField.Flags.ManageMessages]
  });

  assert.equal(result, role);
  assert.equal(role.editedWith.color, undefined);
  assert.equal(role.color, 0);
  assert.equal(role.editedWith.hoist, true);
  assert.equal(role.editedWith.mentionable, true);
  assert.equal(
    role.editedWith.permissions.has(PermissionsBitField.Flags.ManageMessages),
    true
  );
});

test('ensureRole leaves an existing role untouched when settings already match', async () => {
  const role = {
    name: 'Customer',
    color: 0x2ecc71,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(),
    async edit() {
      assert.fail('matching role should not be edited');
    }
  };
  const guild = { roles: { cache: roleCache([role]) } };

  const result = await ensureRole(guild, 'Customer', { color: 0x2ecc71, hoist: false });

  assert.equal(result, role);
});

test('ensureRole updates color only when explicit synchronization is requested', async () => {
  const role = {
    name: 'Loyal Customer',
    color: 0x00d2ff,
    hoist: true,
    mentionable: false,
    permissions: new PermissionsBitField(),
    async edit(changes) {
      Object.assign(this, changes);
      return this;
    }
  };
  const guild = { roles: { cache: roleCache([role]) } };

  await ensureRole(guild, 'Loyal Customer', {
    color: 0x2ecc71,
    syncColor: true,
    hoist: true
  });

  assert.equal(role.color, 0x2ecc71);
});

test('ensureBotDisplayRole hoists the bot below its managed role and above owner', async () => {
  const managedRole = { id: 'managed-bot', name: 'WS Store APP', position: 10 };
  const ownerRole = { id: 'owner', name: 'Owner', position: 7 };
  const displayRole = {
    id: 'bot-display',
    name: 'Bot Display',
    position: 4,
    color: 0,
    hoist: false,
    mentionable: false,
    permissions: new PermissionsBitField(),
    async edit(changes) {
      Object.assign(this, changes);
      return this;
    },
    async setPosition(position) {
      this.position = position;
      return this;
    }
  };
  const assignedRoleIds = new Set();
  const botMember = {
    roles: {
      highest: managedRole,
      cache: { has: (id) => assignedRoleIds.has(id) },
      add: async (role) => assignedRoleIds.add(role.id)
    }
  };
  const guild = {
    members: { me: botMember },
    roles: {
      cache: roleCache([displayRole]),
      create: async () => assert.fail('display role already exists')
    }
  };

  const result = await ensureBotDisplayRole(guild, 'Bot Display', ownerRole, { color: 0x00d2ff });

  assert.equal(result, displayRole);
  assert.equal(displayRole.hoist, true);
  assert.equal(displayRole.position, 7);
  assert.equal(assignedRoleIds.has(displayRole.id), true);
});

test('ensureRoleStackAbove orders tier roles above the customer anchor', async () => {
  const anchorRole = { id: 'customer', position: 5 };
  const positions = new Map([
    ['royal', 2],
    ['diamond', 3],
    ['loyal', 4]
  ]);
  const roles = ['royal', 'diamond', 'loyal'].map((id) => ({
    id,
    get position() {
      return positions.get(id);
    },
    async setPosition(position) {
      const targetPosition = position;
      anchorRole.position -= 1;
      positions.set(id, targetPosition);
      return this;
    }
  }));

  await ensureRoleStackAbove(anchorRole, roles);

  assert.deepEqual(
    [...roles].sort((left, right) => right.position - left.position).map((role) => role.id),
    ['royal', 'diamond', 'loyal']
  );
  assert.equal(roles.every((role) => role.position > anchorRole.position), true);
});
