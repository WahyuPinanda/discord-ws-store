import assert from 'node:assert/strict';
import test from 'node:test';

import { createInviteTrackerFeature } from '../src/services/invite-tracker-service.js';

function inviteCollection(invites) {
  const collection = new Map(invites.map((invite) => [invite.code, invite]));
  collection.map = (callback) => [...collection.values()].map(callback);
  return collection;
}

function invite(code, uses, inviterId = 'inviter-1') {
  return {
    code,
    uses,
    inviterId,
    inviter: { id: inviterId, username: 'Keiii', tag: 'Keiii' }
  };
}

test('invite tracker reports the persistent total across all inviter links', async () => {
  const snapshots = [
    inviteCollection([invite('first', 2), invite('second', 3)]),
    inviteCollection([invite('first', 3), invite('second', 3)])
  ];
  const rpcCalls = [];
  let storedTotal = 0;
  let welcomePayload = null;
  const supabase = {
    async rpc(name, params) {
      rpcCalls.push([name, params]);
      if (name === 'sync_invite_count') {
        storedTotal = Math.max(storedTotal, params.p_observed_total);
      } else if (name === 'increment_invite_count') {
        storedTotal += 1;
      }
      return { data: storedTotal, error: null };
    }
  };
  const unverifiedRole = { id: 'unverified', name: 'Unverified' };
  const welcomeChannel = {
    name: 'welcome',
    async send(payload) {
      welcomePayload = payload;
    }
  };
  const guild = {
    id: 'guild-1',
    name: 'WS Store',
    invites: { fetch: async () => snapshots.shift() },
    roles: { cache: { find: (callback) => callback(unverifiedRole) ? unverifiedRole : null } },
    channels: { cache: { find: (callback) => callback(welcomeChannel) ? welcomeChannel : null } }
  };
  const member = {
    id: 'new-member',
    guild,
    roles: { add: async () => {} }
  };
  const tracker = createInviteTrackerFeature({
    supabase,
    channelMatchesName: (channel, name) => channel.name === name,
    unverifiedRoleName: 'Unverified',
    welcomeChannelName: 'welcome'
  });

  await tracker.refreshInviteCache(guild);
  await tracker.handleGuildMemberAdd(member);

  assert.deepEqual(rpcCalls[0], [
    'sync_invite_count',
    { p_guild_id: 'guild-1', p_inviter_id: 'inviter-1', p_observed_total: 5 }
  ]);
  assert.deepEqual(rpcCalls[1], [
    'increment_invite_count',
    { p_guild_id: 'guild-1', p_inviter_id: 'inviter-1' }
  ]);
  assert.equal(storedTotal, 6);
  assert.match(welcomePayload.content, /now has 6 total invites/);
  assert.equal(welcomePayload.content.includes('now has 3 invite'), false);
});

test('invite tracker falls back to the combined Discord total before schema migration', async () => {
  const snapshots = [
    inviteCollection([invite('first', 4), invite('second', 2)]),
    inviteCollection([invite('first', 5), invite('second', 2)])
  ];
  let welcomePayload = null;
  const supabase = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    }
  };
  const role = { name: 'Unverified' };
  const channel = { name: 'welcome', send: async (payload) => { welcomePayload = payload; } };
  const guild = {
    id: 'guild-1',
    name: 'WS Store',
    invites: { fetch: async () => snapshots.shift() },
    roles: { cache: { find: (callback) => callback(role) ? role : null } },
    channels: { cache: { find: (callback) => callback(channel) ? channel : null } }
  };
  const tracker = createInviteTrackerFeature({
    supabase,
    channelMatchesName: (item, name) => item.name === name,
    unverifiedRoleName: 'Unverified',
    welcomeChannelName: 'welcome',
    logger: { warn() {} }
  });

  await tracker.refreshInviteCache(guild);
  await tracker.handleGuildMemberAdd({
    id: 'new-member',
    guild,
    roles: { add: async () => {} }
  });

  assert.match(welcomePayload.content, /now has 7 total invites/);
});

test('invite tracker ignores bot accounts', async () => {
  const tracker = createInviteTrackerFeature({
    supabase: {},
    channelMatchesName: () => false,
    unverifiedRoleName: 'Unverified',
    welcomeChannelName: 'welcome'
  });

  await tracker.handleGuildMemberAdd({
    user: { bot: true },
    guild: {
      roles: { cache: { find: () => assert.fail('bot role assignment must be skipped') } },
      invites: { fetch: () => assert.fail('bot invite tracking must be skipped') }
    }
  });
});
