import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createServiceStatusFeature,
  manualOverrideIsActive,
  normalizeServiceName
} from '../src/services/service-status-service.js';

const OPEN_HOUR = 10;
const CLOSE_HOUR = 22;

function getUtcHour(date) {
  return date.getUTCHours();
}

function getUtcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function isStoreOpenUtc(date) {
  const hour = getUtcHour(date);
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function createSupabaseStub(initialRows = []) {
  let rows = structuredClone(initialRows);

  return {
    from(table) {
      assert.equal(table, 'service_statuses');
      return {
        select() {
          return {
            async eq(column, guildId) {
              assert.equal(column, 'guild_id');
              return {
                data: rows.filter((row) => row.guild_id === guildId),
                error: null
              };
            }
          };
        },
        async upsert(value) {
          const index = rows.findIndex((row) =>
            row.guild_id === value.guild_id && row.service === value.service
          );
          if (index >= 0) rows[index] = { ...rows[index], ...value };
          else rows.push(value);
          return { error: null };
        }
      };
    }
  };
}

function createFeature(rows) {
  return createServiceStatusFeature({
    supabase: createSupabaseStub(rows),
    definitions: {
      order: {},
      limited: {},
      'via-username': {}
    },
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    getDateKey: getUtcDateKey,
    getHour: getUtcHour,
    isStoreOpen: isStoreOpenUtc
  });
}

test('normalizes legacy service names', () => {
  assert.equal(normalizeServiceName('via_login'), 'via-login');
  assert.equal(normalizeServiceName('via_username'), 'via-username');
  assert.equal(normalizeServiceName('group_payout'), 'group-payout');
  assert.equal(normalizeServiceName('gift_gamepass'), 'gift-gamepass');
  assert.equal(normalizeServiceName('limited'), 'limited');
});

test('manual override remains active only until the next schedule boundary', () => {
  const options = {
    openHour: OPEN_HOUR,
    closeHour: CLOSE_HOUR,
    getDateKey: getUtcDateKey,
    getHour: getUtcHour
  };

  assert.equal(manualOverrideIsActive({
    ...options,
    updatedAt: '2026-07-11T23:30:00.000Z',
    date: new Date('2026-07-12T09:59:00.000Z')
  }), true);
  assert.equal(manualOverrideIsActive({
    ...options,
    updatedAt: '2026-07-11T23:30:00.000Z',
    date: new Date('2026-07-12T10:00:00.000Z')
  }), false);
  assert.equal(manualOverrideIsActive({
    ...options,
    updatedAt: '2026-07-12T12:00:00.000Z',
    date: new Date('2026-07-12T21:59:00.000Z')
  }), true);
  assert.equal(manualOverrideIsActive({
    ...options,
    updatedAt: 'invalid-date',
    date: new Date('2026-07-12T12:00:00.000Z')
  }), false);
});

test('manual open outside hours falls back to the automatic schedule', async () => {
  const guildId = 'guild-1';
  const feature = createFeature([
    { guild_id: guildId, service: 'order', is_open: true, updated_at: '2026-07-11T23:30:00.000Z' },
    { guild_id: guildId, service: 'limited', is_open: true, updated_at: '2026-07-11T20:00:00.000Z' },
    { guild_id: guildId, service: 'via-username', is_open: false, updated_at: '2026-07-11T20:00:00.000Z' }
  ]);
  await feature.loadServiceStatuses(guildId);

  const beforeOpening = new Date('2026-07-12T09:59:00.000Z');
  assert.equal(feature.ticketServiceIsAvailable(guildId, 'order', beforeOpening), true);
  assert.equal(feature.orderTicketServiceIsAvailable(guildId, 'limited', beforeOpening), true);
  assert.equal(feature.orderTicketServiceIsAvailable(guildId, 'via-username', beforeOpening), false);

  assert.equal(feature.ticketServiceIsAvailable(
    guildId,
    'order',
    new Date('2026-07-12T10:00:00.000Z')
  ), true);
  assert.equal(feature.ticketServiceIsAvailable(
    guildId,
    'order',
    new Date('2026-07-12T22:00:00.000Z')
  ), false);
});

test('manual close before opening does not block the next operating window', async () => {
  const guildId = 'guild-2';
  const feature = createFeature([
    { guild_id: guildId, service: 'order', is_open: false, updated_at: '2026-07-12T01:00:00.000Z' }
  ]);
  await feature.loadServiceStatuses(guildId);

  assert.equal(feature.ticketServiceIsAvailable(
    guildId,
    'order',
    new Date('2026-07-12T09:59:00.000Z')
  ), false);
  assert.equal(feature.ticketServiceIsAvailable(
    guildId,
    'order',
    new Date('2026-07-12T10:00:00.000Z')
  ), true);
});

test('rekber remains available regardless of operating hours', () => {
  const feature = createFeature([]);
  assert.equal(feature.ticketServiceIsAvailable(
    'guild-3',
    'rekber',
    new Date('2026-07-12T03:00:00.000Z')
  ), true);
});

test('service status fails closed before the first successful database load', () => {
  const feature = createFeature([]);
  assert.equal(feature.serviceIsOpen('unloaded-guild', 'limited'), false);
});
