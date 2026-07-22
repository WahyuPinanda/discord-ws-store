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
    rekberHistoryChannel: 'rekber-history',
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

function unwrapResult(result, context) {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
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

test('manual transaction is removed when the customer total cannot be saved', async () => {
  const deletedTransactions = [];
  const transaction = {
    id: 44,
    buyer_id: 'buyer-1',
    buyer_tag: 'buyer',
    product: 'Limited Item',
    amount: 100_000,
    payment_method: 'QRIS',
    created_at: new Date().toISOString()
  };
  const supabase = {
    from(table) {
      if (table === 'transactions') {
        return {
          insert() { return this; },
          select() { return this; },
          async single() { return { data: transaction, error: null }; },
          delete() { return this; },
          async eq(column, value) {
            deletedTransactions.push([column, value]);
            return { data: null, error: null };
          }
        };
      }
      if (table === 'customers') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: null, error: null }; },
          async insert() { return { data: null, error: new Error('customer write failed') }; }
        };
      }
      assert.fail(`unexpected table ${table}`);
    }
  };
  const service = createService({ supabase, unwrapSupabase: unwrapResult });
  const interaction = {
    member: {},
    user: { id: 'staff-1' },
    guild: {},
    options: {
      getUser: () => ({ id: 'buyer-1', tag: 'buyer' }),
      getInteger: () => 100_000,
      getString: (name) => name === 'product' ? 'Limited Item' : 'QRIS'
    },
    async deferReply() {}
  };

  await assert.rejects(service.addManualTransaction(interaction), /customer write failed/);
  assert.deepEqual(deletedTransactions, [['id', transaction.id]]);
});

test('ticket completion restores the ticket when the customer total cannot be saved', async () => {
  const deletedTransactions = [];
  const ticketUpdates = [];
  const ticket = {
    id: 17,
    opener_id: 'buyer-1',
    channel_id: 'ticket-17',
    status: 'open',
    total_amount: 0,
    type: 'order'
  };
  const transaction = {
    id: 45,
    buyer_id: 'buyer-1',
    buyer_tag: 'buyer',
    product: 'VILOG',
    amount: 120_000,
    payment_method: 'QRIS',
    created_at: new Date().toISOString()
  };
  const supabase = {
    from(table) {
      if (table === 'tickets') {
        let updatePayload = null;
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: ticket, error: null }; },
          update(payload) {
            updatePayload = payload;
            return this;
          },
          then(resolve) {
            ticketUpdates.push(updatePayload);
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
        };
      }
      if (table === 'transactions') {
        return {
          insert() { return this; },
          select() { return this; },
          async single() { return { data: transaction, error: null }; },
          delete() { return this; },
          async eq(column, value) {
            deletedTransactions.push([column, value]);
            return { data: null, error: null };
          }
        };
      }
      if (table === 'customers') {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: null, error: null }; },
          async insert() { return { data: null, error: new Error('customer write failed') }; }
        };
      }
      assert.fail(`unexpected table ${table}`);
    }
  };
  const service = createService({
    supabase,
    client: { users: { fetch: async () => ({ id: 'buyer-1', tag: 'buyer' }) } },
    unwrapSupabase: unwrapResult
  });
  const values = { product: 'VILOG', amount: '120000', payment: 'QRIS', note: '' };
  const interaction = {
    member: {},
    user: { id: 'staff-1' },
    channelId: 'ticket-17',
    guild: {},
    fields: { getTextInputValue: (name) => values[name] },
    async deferReply() {}
  };

  await assert.rejects(service.completeTicket(interaction), /customer write failed/);
  assert.deepEqual(deletedTransactions, [['id', transaction.id]]);
  assert.deepEqual(ticketUpdates, [
    { status: 'completed', total_amount: 120_000 },
    { status: 'open', total_amount: 0 }
  ]);
});
