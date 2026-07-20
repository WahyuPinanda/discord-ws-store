import assert from 'node:assert/strict';
import test from 'node:test';
import { createInteractionController } from '../src/controllers/interaction-controller.js';
import { withInteractionErrorHandling } from '../src/middlewares/interaction-error-handler.js';

function createController(overrides = {}) {
  const calls = [];
  const record = (name) => async (...args) => calls.push([name, ...args]);
  const dependencies = {
    memberIsStaff: () => true,
    setupServer: record('setupServer'),
    refreshPanelsInBackground: (...args) => calls.push(['refreshPanelsInBackground', ...args]),
    addManualTransaction: record('addManualTransaction'),
    showCustomer: record('showCustomer'),
    openTicketForUser: record('openTicketForUser'),
    setPanelText: record('setPanelText'),
    resetPanelText: record('resetPanelText'),
    handleServiceStatusCommand: record('handleServiceStatusCommand'),
    handleGiveawayCommand: record('handleGiveawayCommand'),
    handleSyncIntegrationsCommand: record('handleSyncIntegrationsCommand'),
    handleVerify: record('handleVerify'),
    createRekberTicket: record('createRekberTicket'),
    createTicket: record('createTicket'),
    claimTicket: record('claimTicket'),
    qrisReplyPayload: (options) => ({ options }),
    showCompleteModal: record('showCompleteModal'),
    closeTicket: record('closeTicket'),
    handleGiveawayJoin: record('handleGiveawayJoin'),
    completeTicket: record('completeTicket'),
    logAdminAction: record('logAdminAction'),
    ...overrides
  };

  return {
    calls,
    handleInteraction: createInteractionController(dependencies)
  };
}

function chatInteraction(commandName) {
  return {
    commandName,
    member: {},
    guild: { id: 'guild-1' },
    user: { id: 'staff-1' },
    isChatInputCommand: () => true,
    isButton: () => false,
    isModalSubmit: () => false,
    async reply(payload) {
      this.replyPayload = payload;
    }
  };
}

function buttonInteraction(customId) {
  return {
    customId,
    isChatInputCommand: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    async reply(payload) {
      this.replyPayload = payload;
    }
  };
}

test('routes service commands with their requested state', async () => {
  const { calls, handleInteraction } = createController();
  const open = chatInteraction('open');
  const close = chatInteraction('close');

  await handleInteraction(open);
  await handleInteraction(close);

  assert.deepEqual(calls[0], ['handleServiceStatusCommand', open, true]);
  assert.deepEqual(calls[1], ['handleServiceStatusCommand', close, false]);
});

test('routes sync-integrations to the integration service', async () => {
  const { calls, handleInteraction } = createController();
  const interaction = chatInteraction('sync-integrations');

  await handleInteraction(interaction);

  assert.deepEqual(calls[0], ['handleSyncIntegrationsCommand', interaction]);
});

test('parses order service buttons without changing the custom id contract', async () => {
  const { calls, handleInteraction } = createController();
  const interaction = buttonInteraction('ticket:create:order:limited');

  await handleInteraction(interaction);

  assert.deepEqual(calls[0], ['createTicket', interaction, 'order', 'limited']);
});

test('rejects refresh-panels for non-staff before scheduling work', async () => {
  const { calls, handleInteraction } = createController({ memberIsStaff: () => false });
  const interaction = chatInteraction('refresh-panels');

  await handleInteraction(interaction);

  assert.match(interaction.replyPayload.content, /Hanya staff/);
  assert.equal(calls.length, 0);
});

test('refresh-panels records the successful admin action', async () => {
  const { calls, handleInteraction } = createController();
  const interaction = chatInteraction('refresh-panels');

  await handleInteraction(interaction);

  assert.deepEqual(calls[0], ['refreshPanelsInBackground', interaction.guild, 'Manual panel']);
  assert.equal(calls[1][0], 'logAdminAction');
  assert.equal(calls[1][2].action, 'Refresh Panels');
});

test('routes ticket completion modal submissions', async () => {
  const { calls, handleInteraction } = createController();
  const interaction = {
    customId: 'ticket:complete-modal:42',
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true
  };

  await handleInteraction(interaction);

  assert.deepEqual(calls[0], ['completeTicket', interaction]);
});

test('routes rekber modal submissions', async () => {
  const { calls, handleInteraction } = createController();
  const interaction = {
    customId: 'ticket:rekber-modal',
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => true
  };

  await handleInteraction(interaction);

  assert.deepEqual(calls[0], ['createRekberTicket', interaction]);
});

test('interaction error middleware sends a safe ephemeral response', async () => {
  const errors = [];
  const interaction = {
    deferred: false,
    replied: false,
    async reply(payload) {
      this.replyPayload = payload;
    }
  };
  const handler = withInteractionErrorHandling(
    async () => {
      throw new Error('sensitive detail');
    },
    { error: (error) => errors.push(error) }
  );

  await handler(interaction);

  assert.equal(errors.length, 1);
  assert.match(interaction.replyPayload.content, /Terjadi error di bot/);
  assert.equal(interaction.replyPayload.content.includes('sensitive detail'), false);
});
