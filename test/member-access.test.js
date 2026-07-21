import assert from 'node:assert/strict';
import test from 'node:test';
import { PermissionFlagsBits } from 'discord.js';

import { createMemberAccessService } from '../src/services/member-access-service.js';

function roleCache(names) {
  const roles = names.map((name, index) => ({ id: String(index + 1), name }));
  roles.find = Array.prototype.find.bind(roles);
  roles.some = Array.prototype.some.bind(roles);
  return roles;
}

const access = createMemberAccessService({
  ownerDiscordId: 'owner-id',
  roles: {
    owner: 'Owner',
    admin: 'Admin',
    middleman: 'Middleman',
    client: 'Verif'
  },
  verifiedRoleAliases: ['Client']
});

test('member access recognizes verified aliases and staff roles', () => {
  const verified = { roles: { cache: roleCache(['Client']) } };
  const staff = {
    permissions: { has: () => false },
    roles: { cache: roleCache(['Middleman']) }
  };

  assert.equal(access.memberIsVerified(verified), true);
  assert.equal(access.memberIsStaff(staff), true);
  assert.deepEqual(access.staffRoleNames(), ['Owner', 'Admin', 'Middleman']);
});

test('member access accepts administrator and configured owner id', () => {
  const administrator = {
    permissions: { has: (permission) => permission === PermissionFlagsBits.Administrator },
    roles: { cache: roleCache([]) }
  };
  const member = { roles: { cache: roleCache([]) } };

  assert.equal(access.memberIsStaff(administrator), true);
  assert.equal(access.memberIsOwner(member, 'owner-id'), true);
});
