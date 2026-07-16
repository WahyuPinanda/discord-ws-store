import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection } from 'discord.js';
import { createAuditLogService } from '../src/services/audit-log-service.js';
import { createAntiSpamFeature } from '../src/services/anti-spam-service.js';

function embedBase() {
  return {
    data: {},
    setColor(value) {
      this.data.color = value;
      return this;
    },
    setTitle(value) {
      this.data.title = value;
      return this;
    },
    setTimestamp(value) {
      this.data.timestamp = value;
      return this;
    },
    setDescription(value) {
      this.data.description = value;
      return this;
    },
    addFields(fields) {
      this.data.fields = fields;
      return this;
    }
  };
}

function auditContext({ failChannel = null } = {}) {
  const sent = [];
  const warnings = [];
  const names = {
    admin: 'admin-log',
    ticket: 'ticket-log',
    order: 'order-log',
    moderation: 'mod-log'
  };
  const channels = Object.values(names).map((name) => ({
    name,
    async send(payload) {
      if (name === failChannel) throw new Error('send denied');
      sent.push({ name, payload });
    }
  }));
  const guild = {
    channels: {
      cache: {
        find: (callback) => channels.find(callback) || null
      }
    }
  };
  const service = createAuditLogService({
    channelMatchesName: (channel, name) => channel.name === name,
    embedBase,
    channelNames: names,
    logger: { warn: (...args) => warnings.push(args) }
  });
  return { guild, sent, service, warnings };
}

test('audit log service routes every event type to its dedicated channel', async () => {
  const { guild, sent, service } = auditContext();

  await service.logAdminAction(guild, { action: 'Refresh Panels', actorId: 'staff-1' });
  await service.logTicketEvent(guild, { event: 'Ticket Created', ticketId: 12, openerId: 'buyer-1' });
  await service.logOrderEvent(guild, { transactionId: 8, buyerId: 'buyer-1', amount: 'Rp100.000' });
  await service.logModerationEvent(guild, { action: 'Spam Warning', userId: 'member-1' });

  assert.deepEqual(sent.map((item) => item.name), [
    'admin-log',
    'ticket-log',
    'order-log',
    'mod-log'
  ]);
  assert.deepEqual(sent.map((item) => item.payload.embeds[0].data.title), [
    '📋 Admin Action',
    '🎫 Ticket Created',
    '💰 Order Recorded',
    '🚨 Moderation Action'
  ]);
});

test('audit logging failures are reported without throwing into business operations', async () => {
  const { guild, sent, service, warnings } = auditContext({ failChannel: 'order-log' });

  const result = await service.logOrderEvent(guild, {
    transactionId: 8,
    buyerId: 'buyer-1',
    amount: 'Rp100.000'
  });

  assert.equal(result, false);
  assert.equal(sent.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /Failed to send audit log/);
});

function spamMessage({ userId, moderatable = false, timeoutCalls = [] }) {
  const now = Date.now();
  const recentMessages = new Collection([
    ['one', { author: { id: userId }, createdTimestamp: now, deletable: true, delete: async () => {} }],
    ['two', { author: { id: userId }, createdTimestamp: now, deletable: true, delete: async () => {} }]
  ]);
  const channel = {
    id: 'chat-1',
    messages: { fetch: async () => recentMessages },
    bulkDelete: async () => {},
    send: async () => ({ delete: async () => {} })
  };
  return {
    guildId: 'guild-1',
    guild: { members: { fetch: async () => null } },
    channelId: channel.id,
    channel,
    author: { id: userId, bot: false },
    member: {
      moderatable,
      timeout: async (...args) => timeoutCalls.push(args)
    }
  };
}

test('anti-spam sends first-warning events to the moderation logger', async () => {
  const events = [];
  const feature = createAntiSpamFeature({
    settings: {
      windowMs: 10_000,
      maxMessages: 2,
      rapidWindowMs: 100,
      rapidMaxMessages: 99,
      cleanupWindowMs: 15_000,
      warningExpiresMs: 60_000,
      timeoutMs: 300_000
    },
    memberIsStaff: () => false,
    logModerationEvent: async (...args) => events.push(args)
  });
  const message = spamMessage({ userId: 'warning-user' });

  await feature.handleMessageCreate(message);
  await feature.handleMessageCreate(message);

  assert.equal(events.length, 1);
  assert.equal(events[0][1].action, 'Spam Warning');
  assert.equal(events[0][1].deletedMessages, 2);
});

test('anti-spam sends successful timeout events to the moderation logger', async () => {
  const events = [];
  const timeoutCalls = [];
  const feature = createAntiSpamFeature({
    settings: {
      windowMs: 10_000,
      maxMessages: 99,
      rapidWindowMs: 10_000,
      rapidMaxMessages: 2,
      cleanupWindowMs: 15_000,
      warningExpiresMs: 60_000,
      timeoutMs: 300_000
    },
    memberIsStaff: () => false,
    logModerationEvent: async (...args) => events.push(args)
  });
  const message = spamMessage({ userId: 'timeout-user', moderatable: true, timeoutCalls });

  await feature.handleMessageCreate(message);
  await feature.handleMessageCreate(message);

  assert.equal(timeoutCalls.length, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0][1].action, 'Spam Timeout');
  assert.match(events[0][1].outcome, /Timed out/);
});
