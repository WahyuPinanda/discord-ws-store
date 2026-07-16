import assert from 'node:assert/strict';
import test from 'node:test';
import { ChannelType } from 'discord.js';
import { createTicketCreationFeature } from '../src/services/ticket-creation-service.js';

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
  let channelCreateOptions = null;
  let sentPayload = null;
  const ticketEvents = [];
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
      async create(options) {
        channelCreateCount += 1;
        channelCreateOptions = options;
        const id = `channel-${channelCreateCount}`;
        return {
          id,
          async send(payload) {
            if (failSend) throw new Error('send failed');
            sentPayload = payload;
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
    unwrapSupabase: (result) => {
      if (result.error) throw result.error;
      return result.data;
    },
    embedBase: () => ({
      setTitle() {
        return this;
      },
      setDescription() {
        return this;
      }
    }),
    logTicketEvent: async (...args) => ticketEvents.push(args)
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
    },
    get channelCreateOptions() {
      return channelCreateOptions;
    },
    get sentPayload() {
      return sentPayload;
    },
    get ticketEvents() {
      return ticketEvents;
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
  assert.equal(context.ticketEvents.length, 1);
  assert.equal(context.ticketEvents[0][1].event, 'Ticket Created');
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

test('rekber ticket grants access and mentions both transaction parties', async () => {
  const context = createContext();
  const seller = {
    id: 'seller-1',
    user: { id: 'seller-1', username: 'seller123' }
  };

  await context.feature.createTicketForMember(
    context.interaction,
    'rekber',
    context.openerMember,
    {
      additionalMembers: [context.openerMember, seller],
      rekberDetails: {
        buyerId: 'buyer-1',
        buyerUsername: 'keii123',
        sellerId: 'seller-1',
        sellerUsername: 'seller123',
        transactionAmount: 'Rp150.000'
      }
    }
  );

  const overwriteIds = context.channelCreateOptions.permissionOverwrites.map((item) => item.id);
  assert.equal(overwriteIds.filter((id) => id === 'buyer-1').length, 1);
  assert.equal(overwriteIds.filter((id) => id === 'seller-1').length, 1);
  assert.equal(context.sentPayload.content, '<@buyer-1> <@seller-1>');
  assert.deepEqual(context.sentPayload.allowedMentions, { users: ['buyer-1', 'seller-1'] });
});
