import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIntegrationPermissionService,
  findNotifyMeRole,
  NOTIFYME_PUBLISH_PERMISSIONS
} from '../src/services/integration-permission-service.js';

function cache(items) {
  const collection = new Map(items.map((item) => [item.id || item.name, item]));
  collection.find = (callback) => items.find(callback) || null;
  return collection;
}

test('NotifyMe role exposes every required publishing permission', () => {
  assert.equal(NOTIFYME_PUBLISH_PERMISSIONS.length, 8);
  assert.equal(new Set(NOTIFYME_PUBLISH_PERMISSIONS).size, 8);
});

test('findNotifyMeRole detects the managed role case-insensitively', () => {
  const role = { id: 'notify-role', name: 'NotifyMe' };
  const guild = { roles: { cache: cache([role]) } };

  assert.equal(findNotifyMeRole(guild), role);
});

test('integration service grants NotifyMe access to social media channel', async () => {
  const role = { id: 'notify-role', name: 'NotifyMe' };
  let edited = null;
  const channel = {
    name: 'social-media',
    permissionOverwrites: {
      async edit(target, permissions, options) {
        edited = { target, permissions, options };
      }
    }
  };
  const guild = {
    roles: { cache: cache([role]) },
    channels: { cache: cache([channel]) }
  };
  const service = createIntegrationPermissionService({
    channelMatchesName: (item, name) => item.name === name,
    socialMediaChannelName: 'social-media'
  });

  assert.equal(await service.ensureNotifyMeChannelAccess(guild), true);
  assert.equal(edited.target, role);
  assert.equal(edited.permissions.ViewChannel, true);
  assert.equal(edited.permissions.ManageWebhooks, true);
  assert.equal(edited.permissions.SendMessages, true);
  assert.equal(edited.permissions.EmbedLinks, true);
  assert.equal(edited.permissions.MentionEveryone, true);
  assert.equal(edited.permissions.BypassSlowmode, true);
  assert.match(edited.options.reason, /NotifyMe/);
});

test('integration service grants access automatically when NotifyMe joins', async () => {
  const role = { id: 'managed-notify-role', name: 'NotifyMe', tags: { botId: 'notify-bot' } };
  const unverifiedRole = { id: 'unverified', name: 'Unverified' };
  let editCount = 0;
  let removedRoles = [];
  const channel = {
    name: 'social-media',
    permissionOverwrites: { edit: async () => { editCount += 1; } }
  };
  const guild = {
    roles: { cache: cache([role]) },
    channels: { cache: cache([channel]) }
  };
  const member = {
    id: 'notify-bot',
    user: { bot: true, username: 'NotifyMe' },
    roles: {
      cache: cache([role, unverifiedRole]),
      remove: async (roles) => { removedRoles = roles; }
    },
    guild
  };
  const service = createIntegrationPermissionService({
    channelMatchesName: (item, name) => item.name === name,
    socialMediaChannelName: 'social-media',
    memberRoleNamesToRemove: ['Unverified']
  });

  assert.equal(await service.handleIntegrationMemberAdd(member), true);
  assert.equal(editCount, 2);
  assert.deepEqual(removedRoles, [unverifiedRole]);
});

test('sync integrations command reports a successful permission refresh', async () => {
  const role = { id: 'notify-role', name: 'NotifyMe' };
  const channel = {
    name: 'social-media',
    permissionOverwrites: { edit: async () => {} }
  };
  const guild = {
    roles: { cache: cache([role]) },
    channels: { cache: cache([channel]) },
    members: { cache: cache([]) }
  };
  let reply = null;
  const service = createIntegrationPermissionService({
    channelMatchesName: (item, name) => item.name === name,
    socialMediaChannelName: 'social-media',
    memberIsStaff: () => true
  });

  await service.handleSyncIntegrationsCommand({
    member: {},
    guild,
    user: { id: 'staff-1' },
    deferReply: async () => {},
    editReply: async (content) => { reply = content; }
  });

  assert.match(reply, /berhasil disinkronkan/);
});
