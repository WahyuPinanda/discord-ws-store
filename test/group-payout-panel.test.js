import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { groupPayoutPricePayload } from '../src/services/group-payout-panel-service.js';

function embedBase() {
  return new EmbedBuilder().setColor(0x2ecc71);
}

test('group payout panel includes rate, community links, banner, and ticket button', () => {
  const payload = groupPayoutPricePayload(embedBase);
  const embed = payload.embeds[0].toJSON();
  const button = payload.components[0].components[0].toJSON();

  assert.match(embed.title, /PAYOUT COMMUNITY/);
  assert.match(embed.description, /Rate: Rp 120 \/ 1 Robux/);
  assert.match(embed.description, /100 🪙 ➤ Rp 12\.000/);
  assert.match(embed.description, /10000 🪙 ➤ Rp 1\.200\.000/);
  assert.match(embed.description, /1064667246\/BEJIRLAH-Community/);
  assert.match(embed.description, /1108229986\/Vandamoy/);
  assert.match(embed.description, /groups\/654669898/);
  assert.ok(embed.description.length <= 4096);
  assert.equal(button.custom_id, 'ticket:create:order:group-payout');
  assert.equal(payload.files[0].name, 'ws-store-group-payout.png');
});

test('group payout panel accepts text overrides without losing its banner or ticket button', () => {
  const payload = groupPayoutPricePayload(embedBase, {
    title: 'Harga Payout Baru',
    description: 'Rate terbaru tersedia.'
  });

  assert.equal(payload.embeds[0].data.title, 'Harga Payout Baru');
  assert.equal(payload.embeds[0].data.description, 'Rate terbaru tersedia.');
  assert.equal(payload.components[0].components[0].data.custom_id, 'ticket:create:order:group-payout');
  assert.equal(payload.files[0].name, 'ws-store-group-payout.png');
});
