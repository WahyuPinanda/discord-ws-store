import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionsBitField } from 'discord.js';

import { ensureRole } from '../src/services/discord-resource-service.js';

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
