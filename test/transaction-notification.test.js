import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { createTransactionNotificationService } from '../src/services/transaction-notification-service.js';

function createContext() {
  const messages = new Map();
  const channels = ['success', 'rekber-history'].map((name) => ({
    name,
    async send(payload) {
      messages.set(name, payload);
    }
  }));
  channels.find = Array.prototype.find.bind(channels);

  const service = createTransactionNotificationService({
    successTransactionChannel: 'success',
    rekberHistoryChannel: 'rekber-history',
    embedBase: () => new EmbedBuilder(),
    formatRupiah: (amount) => `Rp ${amount}`,
    channelMatchesName: (channel, expected) => channel.name === expected
  });

  return {
    messages,
    service,
    guild: { channels: { cache: channels } },
    transaction: {
      id: 1,
      product: 'Rekber Akun',
      amount: 3_700_000,
      payment_method: 'QRIS',
      handled_by: 'staff-1',
      created_at: new Date().toISOString()
    }
  };
}

test('rekber completion is published to transaction success and rekber history', async () => {
  const context = createContext();

  const results = await context.service.postTransaction(
    context.guild,
    context.transaction,
    'buyer-1',
    3_785_000,
    { name: 'Loyal Customer' },
    'rekber'
  );

  assert.deepEqual(results, [true, true]);
  assert.equal(context.messages.size, 2);
  assert.equal(context.messages.get('success').embeds[0].data.title, '✅ TRANSACTION SUCCESS');
  assert.equal(context.messages.get('rekber-history').embeds[0].data.title, '🤝 REKBER SUCCESS');
});

test('regular transactions are not copied into rekber history', async () => {
  const context = createContext();

  const results = await context.service.postTransaction(
    context.guild,
    context.transaction,
    'buyer-1',
    3_785_000,
    null,
    'order'
  );

  assert.deepEqual(results, [true]);
  assert.deepEqual([...context.messages.keys()], ['success']);
});
