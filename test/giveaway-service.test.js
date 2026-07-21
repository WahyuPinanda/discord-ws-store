import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';

import { createGiveawayFeature } from '../src/services/giveaway-service.js';

function createContext({ failMessageSave = false, failSend = false } = {}) {
  const updates = [];
  let messageDeleted = false;
  const giveaway = {
    id: 7,
    guild_id: 'guild-1',
    channel_id: 'giveaway-channel',
    host_id: 'staff-1',
    prize: '100 Robux',
    winners_count: 1,
    ends_at: new Date(Date.now() + 60_000).toISOString(),
    status: 'active'
  };
  const supabase = {
    from(table) {
      assert.equal(table, 'giveaways');
      return {
        insert() {
          return {
            select() {
              return { single: async () => ({ data: giveaway, error: null }) };
            }
          };
        },
        update(value) {
          return {
            async eq(column, id) {
              assert.equal(column, 'id');
              assert.equal(id, giveaway.id);
              updates.push(value);
              const error = value.message_id && failMessageSave
                ? new Error('message id update failed')
                : null;
              return { error };
            }
          };
        }
      };
    }
  };
  const channel = {
    id: 'giveaway-channel',
    async send() {
      if (failSend) throw new Error('Discord send failed');
      return {
        id: 'message-1',
        async delete() { messageDeleted = true; }
      };
    }
  };
  const interaction = {
    member: {},
    guildId: 'guild-1',
    guild: {
      channels: { cache: { find: () => null } },
      roles: { cache: { find: () => null } }
    },
    channel,
    user: { id: 'staff-1' },
    options: {
      getSubcommand: () => 'create',
      getString: (name) => name === 'prize' ? '100 Robux' : '1h',
      getInteger: () => 1
    },
    async deferReply() {},
    async editReply(value) { this.reply = value; }
  };
  const feature = createGiveawayFeature({
    client: {},
    supabase,
    embedBase: () => new EmbedBuilder(),
    memberIsStaff: () => true,
    channelMatchesName: () => false,
    giveawayChannelName: 'giveaways',
    logger: { warn() {}, error() {} }
  });

  return {
    feature,
    interaction,
    updates,
    get messageDeleted() { return messageDeleted; }
  };
}

test('giveaway creation closes its database record when Discord send fails', async () => {
  const context = createContext({ failSend: true });

  await assert.rejects(
    context.feature.handleGiveawayCommand(context.interaction),
    /Discord send failed/
  );

  assert.equal(context.updates.at(-1).status, 'ended');
});

test('giveaway creation removes its message and closes the record when message id save fails', async () => {
  const context = createContext({ failMessageSave: true });

  await assert.rejects(
    context.feature.handleGiveawayCommand(context.interaction),
    /message id update failed/
  );

  assert.equal(context.messageDeleted, true);
  assert.equal(context.updates.at(-1).status, 'ended');
});

test('giveaway creation publishes and stores its message id on success', async () => {
  const context = createContext();

  await context.feature.handleGiveawayCommand(context.interaction);

  assert.deepEqual(context.updates, [{ message_id: 'message-1' }]);
  assert.match(context.interaction.reply, /Giveaway dibuat/);
});
