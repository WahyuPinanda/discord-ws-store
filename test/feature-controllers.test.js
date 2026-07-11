import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminController } from '../src/controllers/admin-controller.js';
import { createTicketController } from '../src/controllers/ticket-controller.js';

function createTicketControllerContext(overrides = {}) {
  const calls = [];
  const controller = createTicketController({
    config: { timezone: 'Asia/Jakarta' },
    supabase: {},
    unwrapSupabase: (result) => result.data,
    embedBase: () => ({}),
    memberIsStaff: () => false,
    memberIsVerified: () => false,
    findVerifiedRole: () => null,
    unverifiedRoleName: 'Unverified',
    orderTicketService: () => ({ label: 'Limited Item' }),
    orderTicketServiceIsAvailable: () => true,
    ticketServiceIsAvailable: () => true,
    serviceStatusIsSet: () => false,
    ticketTypeLabel: () => 'Order Ticket',
    operatingStatusText: () => 'CLOSED',
    createTicketForMember: async (...args) => {
      calls.push(args);
      return { channelId: 'ticket-channel' };
    },
    ...overrides
  });
  return { calls, controller };
}

test('ticket controller rejects unverified members before creating a ticket', async () => {
  const { calls, controller } = createTicketControllerContext();
  const interaction = {
    member: {},
    guildId: 'guild-1',
    async reply(payload) {
      this.replyPayload = payload;
    }
  };

  await controller.createTicket(interaction, 'order', 'limited');

  assert.match(interaction.replyPayload.content, /verify terlebih dahulu/);
  assert.equal(calls.length, 0);
});

test('verification fails closed when the verified role is missing', async () => {
  const { controller } = createTicketControllerContext();
  const interaction = {
    member: { roles: { add: async () => assert.fail('role should not be added') } },
    guild: { roles: { cache: { find: () => null } } },
    async reply(payload) {
      this.replyPayload = payload;
    }
  };

  await controller.handleVerify(interaction);

  assert.match(interaction.replyPayload.content, /Role verifikasi belum tersedia/);
});

test('staff open-ticket bypasses store hours for the selected member', async () => {
  const targetUser = { id: 'buyer-1' };
  const openerMember = { id: 'buyer-1', user: targetUser };
  const { calls, controller } = createTicketControllerContext({ memberIsStaff: () => true });
  const interaction = {
    member: {},
    user: { id: 'staff-1' },
    guildId: 'guild-1',
    guild: { members: { fetch: async () => openerMember } },
    options: {
      getUser: () => targetUser,
      getString: (name) => name === 'type' ? 'order' : 'limited'
    },
    async deferReply() {},
    async editReply(payload) {
      this.editPayload = payload;
    }
  };

  await controller.openTicketForUser(interaction);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], openerMember);
  assert.deepEqual(calls[0][3], {
    bypassStoreHours: true,
    openedByStaff: true,
    service: 'limited'
  });
  assert.match(interaction.editPayload, /berhasil dibuat/);
});

test('admin controller updates order status and schedules a UI refresh', async () => {
  const calls = [];
  const controller = createAdminController({
    supabase: {},
    memberIsStaff: () => true,
    editablePanelTypes: () => new Set(),
    isPanelTextOverrideSchemaMissing: () => false,
    refreshGuildUiInBackground: (...args) => calls.push(['refresh', ...args]),
    updateServiceStatus: async (...args) => calls.push(['update', ...args]),
    serviceDefinitions: { order: { statsLabel: 'Order' } }
  });
  const interaction = {
    member: {},
    guild: { id: 'guild-1' },
    user: { id: 'staff-1' },
    options: { getSubcommand: () => 'order' },
    async deferReply() {},
    async editReply(payload) {
      this.editPayload = payload;
    }
  };

  await controller.handleServiceStatusCommand(interaction, true);

  assert.deepEqual(calls[0], ['update', interaction.guild, 'order', true, 'staff-1']);
  assert.deepEqual(calls[1], ['refresh', interaction.guild, 'Service status']);
  assert.match(interaction.editPayload, /OPEN/);
});
