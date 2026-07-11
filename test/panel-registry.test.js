import assert from 'node:assert/strict';
import test from 'node:test';

import { createPanelRegistryService } from '../src/services/panel-registry-service.js';

function createRegistry({ fetchError }) {
  let sendCount = 0;
  let upsertCount = 0;

  const existingPanel = {
    guild_id: 'guild-1',
    channel_id: 'channel-old',
    message_id: 'message-old',
    type: 'order'
  };

  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({ data: existingPanel, error: null })
                  };
                }
              };
            }
          };
        },
        upsert: async () => {
          upsertCount += 1;
          return { data: null, error: null };
        }
      };
    }
  };

  const service = createPanelRegistryService({
    supabase,
    client: {
      channels: {
        fetch: async () => {
          throw fetchError;
        }
      }
    },
    unwrapSupabase(result) {
      if (result.error) throw result.error;
      return result.data;
    },
    loadServiceStatuses: async () => {},
    payloadFactories: {}
  });

  const channel = {
    guildId: 'guild-1',
    id: 'channel-new',
    send: async () => {
      sendCount += 1;
      return {
        guildId: 'guild-1',
        channelId: 'channel-new',
        id: 'message-new'
      };
    }
  };

  return {
    channel,
    service,
    counts: () => ({ sendCount, upsertCount })
  };
}

test('panel publishing does not create duplicates for Discord permission errors', async () => {
  const permissionError = Object.assign(new Error('Missing Access'), { code: 50001 });
  const { channel, service, counts } = createRegistry({ fetchError: permissionError });

  await assert.rejects(
    service.publishOrEditPanel(channel, 'order', { content: 'panel' }),
    permissionError
  );
  assert.deepEqual(counts(), { sendCount: 0, upsertCount: 0 });
});

test('panel publishing recreates a panel when its old Discord message is gone', async () => {
  const unknownMessage = Object.assign(new Error('Unknown Message'), { code: 10008 });
  const { channel, service, counts } = createRegistry({ fetchError: unknownMessage });

  const message = await service.publishOrEditPanel(channel, 'order', { content: 'panel' });

  assert.equal(message.id, 'message-new');
  assert.deepEqual(counts(), { sendCount: 1, upsertCount: 1 });
});
