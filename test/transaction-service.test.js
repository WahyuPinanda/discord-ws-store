import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { createTransactionService } from '../src/services/transaction-service.js';

function createService(overrides = {}) {
  return createTransactionService({
    supabase: { from: () => assert.fail('database should not be queried') },
    client: {},
    config: { storeName: 'WS Store', timezone: 'Asia/Jakarta' },
    customerRoleName: 'Customer',
    tierRoles: [],
    successTransactionChannel: 'success',
    ticketTranscriptChannel: 'transcript',
    ticketLogChannel: 'ticket-log',
    embedBase: () => ({}),
    formatRupiah: String,
    channelMatchesName: () => false,
    memberIsStaff: () => true,
    unwrapSupabase: (result) => result.data,
    ...overrides
  });
}

test('completion modal opens immediately without waiting for a database query', async () => {
  const service = createService();
  const interaction = {
    member: {},
    async showModal(modal) {
      this.modal = modal;
    }
  };

  await service.showCompleteModal(interaction);

  assert.equal(interaction.modal.data.custom_id, 'ticket:complete-modal');
  const inputs = interaction.modal.components.map((row) => row.components[0].data);
  assert.deepEqual(inputs.map((input) => input.max_length), [100, 20, 50, 1000]);
});

test('completion modal remains restricted to staff', async () => {
  const service = createService({ memberIsStaff: () => false });
  const interaction = {
    member: {},
    async reply(payload) {
      this.payload = payload;
    },
    async showModal() {
      assert.fail('modal should not open');
    }
  };

  await service.showCompleteModal(interaction);

  assert.match(interaction.payload.content, /Hanya staff/);
});

test('completion form submission rechecks staff permission', async () => {
  const service = createService({ memberIsStaff: () => false });
  const interaction = {
    member: {},
    channelId: 'ticket-channel',
    async reply(payload) {
      this.payload = payload;
    }
  };

  await service.completeTicket(interaction);

  assert.match(interaction.payload.content, /Hanya staff/);
});

test('customer profile repairs the customer role without changing the stored total', async () => {
  const roleActions = [];
  const roles = [{ id: 'customer-role', name: 'Customer', editable: true }];
  roles.find = Array.prototype.find.bind(roles);
  const service = createService({
    supabase: {
      from(table) {
        assert.equal(table, 'customers');
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() {
            return { data: { discord_user_id: 'buyer-1', total_spent: 255_000, tier: null }, error: null };
          }
        };
      }
    },
    embedBase: () => new EmbedBuilder(),
    formatRupiah: (amount) => `Rp${amount}`
  });
  const interaction = {
    user: { id: 'buyer-1' },
    member: {},
    options: { getUser: () => ({ id: 'buyer-1' }) },
    guild: {
      members: {
        fetch: async () => ({
          roles: {
            cache: new Map(),
            add: async (role) => roleActions.push(['add', role.id]),
            remove: async () => assert.fail('no tier role should be removed')
          }
        })
      },
      roles: { cache: roles, fetch: async () => roles }
    },
    async deferReply() {},
    async editReply(payload) { this.payload = payload; }
  };

  await service.showCustomer(interaction);

  assert.deepEqual(roleActions, [['add', 'customer-role']]);
  assert.match(interaction.payload.embeds[0].data.fields.at(-1).value, /Tersinkronisasi/);
});
