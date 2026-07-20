import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { itemTumbalTradePayload } from '../src/services/market-panel-service.js';

function embedBase() {
  return new EmbedBuilder().setColor(0x2ecc71);
}

test('item tumbal panel opens a limited item ticket with the standard diamond button', () => {
  const payload = itemTumbalTradePayload(embedBase);
  const button = payload.components[0].components[0].toJSON();

  assert.equal(button.custom_id, 'ticket:create:order:limited');
  assert.equal(button.label, 'Buy Limited Item');
  assert.equal(button.emoji.name, '💎');
});
