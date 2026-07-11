import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType } from 'discord.js';
import { createTicketCreationFeature } from '../src/features/ticket-creation.js';

function createTicketDbStub() {
  const tickets = [];
  let insertCount = 0;

  return {
    tickets,
    get insertCount() {
      return insertCount;
    },
    from(table) {
      assert.equal(table, 'tickets');
      return {
        select() {
          const filters = {};
          const builder = {
            eq(column, value) {
              filters[column] = value;
              return builder;
            },
            in(column, values) {
              filters[column] = values;
              return builder;
            },
            async maybeSingle() {
              const row = tickets.find((ticket) =>
                ticket.guild_id === filters.guild_id
                && ticket.opener_id === filters.opener_id
                && ticket.type === filters.type
                && filters.status.includes(ticket.status)
              );
              return { data: row || null, error: null };
            }
          };
          return builder;
        },
        insert(value) {
          insertCount += 1;
          const ticket = { id: insertCount, status: 'open', channel_id: null, ...value };
          tickets.push(ticket);
          return {
            select() {
              return {
                async single() {
                  return { data: ticket, error: null };
                }
              };
            }
          };
        },
        update(value) {
          return {
            async eq(column, id) {
              const ticket = tickets.find((item) => item[column] === id);
              if (ticket) Object.assign(ticket, value);
              return { error: null };
            }
          };
        }
      };
    }
  };
}

function createContext({ failSend = false } = {}) {
  const db = createTicketDbStub();
  let channelCreateCount = 0;
  let channelDeleteCount = 0;
  const category = { id: 'active-category', type: ChannelType.GuildCategory, name: 'ACTIVE TICKETS' };
  const everyone = { id: 'everyone' };
  const staffRole = { id: 'staff', name: 'Admin' };
  const guild = {
    roles: {
      everyone,
      cache: {
        find(callback) {
          return callback(staffRole) ? staffRole : null;
        }
      }
    },
    channels: {
      cache: {
        find(callback) {
          return callback(category) ? category : null;
        }
      },
      async create() {
        channelCreateCount += 1;
        const id = `channel-${channelCreateCount}`;
        return {
          id,
          async send() {
            if (failSend) throw new Error('send failed');
          },
          async delete() {
            channelDeleteCount += 1;
          }
        };
      }
    }
  };
  const interaction = {
    guildId: 'guild-1',
    guild,
    user: { id: 'staff-user' }
  };
  const openerMember = {
    id: 'buyer-1',
    user: { id: 'buyer-1', tag: 'buyer#0001' }
  };
  const feature = createTicketCreationFeature({
    supabase: db,
    activeTicketCategoryName: 'ACTIVE TICKETS',
    staffRoleNames: () => ['Admin'],
    orderTicketService: () => ({ service: 'limited', label: 'Limited Item', emoji: '💎' }),
    ticketTypeLabel: () => 'Order Ticket',
    ticketControlRows: () => [],
    embedBase: () => ({
      setTitle() {
        return this;
      },
      setDescription() {
        return this;
      }
    })
  });

  return {
    db,
    feature,
    interaction,
    openerMember,
    get channelCreateCount() {
      return channelCreateCount;
    },
    get channelDeleteCount() {
      return channelDeleteCount;
    }
  };
}

test('concurrent ticket requests create only one ticket and one channel', async () => {
  const context = createContext();
  const options = { service: 'limited' };
  const [first, second] = await Promise.all([
    context.feature.createTicketForMember(context.interaction, 'order', context.openerMember, options),
    context.feature.createTicketForMember(context.interaction, 'order', context.openerMember, options)
  ]);

  assert.equal(context.db.insertCount, 1);
  assert.equal(context.channelCreateCount, 1);
  assert.equal(first.channelId, 'channel-1');
  assert.equal(second.existingChannelId, 'channel-1');
});

test('failed channel initialization rolls back the ticket record', async () => {
  const context = createContext({ failSend: true });

  await assert.rejects(
    context.feature.createTicketForMember(
      context.interaction,
      'order',
      context.openerMember,
      { service: 'limited' }
    ),
    /send failed/
  );

  assert.equal(context.channelDeleteCount, 1);
  assert.equal(context.db.tickets[0].status, 'closed');
});
