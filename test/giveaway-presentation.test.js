import assert from 'node:assert/strict';
import test from 'node:test';

import {
  giveawayEntriesForMember,
  parseGiveawayDurationMs,
  pickWeightedWinners
} from '../src/services/giveaway-presentation-service.js';

test('giveaway duration parser accepts bounded minute, hour, and day values', () => {
  assert.equal(parseGiveawayDurationMs('30m'), 30 * 60_000);
  assert.equal(parseGiveawayDurationMs('4H'), 4 * 60 * 60_000);
  assert.equal(parseGiveawayDurationMs('2d'), 2 * 24 * 60 * 60_000);
  assert.equal(parseGiveawayDurationMs('0m'), null);
  assert.equal(parseGiveawayDurationMs('366d'), null);
  assert.equal(parseGiveawayDurationMs('soon'), null);
});

test('giveaway entry calculation selects the highest eligible role weight', () => {
  const roles = [{ name: 'Verif' }, { name: 'Royal' }];
  roles.some = Array.prototype.some.bind(roles);
  const member = { roles: { cache: roles } };
  const rules = [
    { role: 'Verif', entries: 1 },
    { role: 'Royal', entries: 12 }
  ];

  assert.equal(giveawayEntriesForMember(member, rules), 12);
});

test('weighted winner selection never returns the same participant twice', () => {
  const entries = [
    { user_id: 'one', entries: 1 },
    { user_id: 'two', entries: 5 },
    { user_id: 'three', entries: 2 }
  ];
  const randomValues = [0.99, 0];
  const winners = pickWeightedWinners(entries, 2, () => randomValues.shift());

  assert.equal(winners.length, 2);
  assert.equal(new Set(winners.map((winner) => winner.user_id)).size, 2);
  assert.equal(entries.length, 3);
});
