import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { createCorePayloadService } from '../src/services/core-payload-service.js';

const service = createCorePayloadService({
  config: {
    qrisImagePath: 'assets/qris-ws-store.png',
    storeName: 'WS Store Official'
  },
  embedBase: () => new EmbedBuilder().setColor(0x2ecc71),
  verifyImagePath: 'assets/ws-store-verify-banner.png'
});

test('core payload keeps stable verification and ticket action contracts', () => {
  const verify = service.verifyPanelPayload();
  const verifyButton = verify.components[0].components[0].toJSON();
  const orderRows = service.ticketControlRows('order');
  const supportRows = service.ticketControlRows('support');

  assert.equal(verifyButton.custom_id, 'verify:member');
  assert.equal(verifyButton.label, 'Verify');
  assert.equal(verify.files[0].name, 'ws-store-verify-banner.png');
  assert.equal(orderRows[0].components.some((button) => button.data.custom_id === 'ticket:complete'), true);
  assert.equal(supportRows[0].components.some((button) => button.data.custom_id === 'ticket:complete'), false);
});

test('QRIS payload attaches the configured image', () => {
  const payload = service.qrisReplyPayload({ ephemeral: true });

  assert.equal(payload.files[0].name, 'qris-ws-store.png');
  assert.equal(payload.embeds[0].data.image.url, 'attachment://qris-ws-store.png');
  assert.ok(payload.flags);
});
