import { MessageFlags } from 'discord.js';

export function createInteractionController({
  memberIsStaff,
  setupServer,
  refreshPanelsInBackground,
  addManualTransaction,
  showCustomer,
  openTicketForUser,
  setPanelText,
  resetPanelText,
  handleServiceStatusCommand,
  handleGiveawayCommand,
  handleVerify,
  createTicket,
  claimTicket,
  qrisReplyPayload,
  showCompleteModal,
  closeTicket,
  handleGiveawayJoin,
  completeTicket
}) {
  async function handleChatCommand(interaction) {
    const handlers = {
      'setup-server': () => setupServer(interaction),
      'add-transaction': () => addManualTransaction(interaction),
      customer: () => showCustomer(interaction),
      'open-ticket': () => openTicketForUser(interaction),
      'set-panel-text': () => setPanelText(interaction),
      'reset-panel-text': () => resetPanelText(interaction),
      open: () => handleServiceStatusCommand(interaction, true),
      close: () => handleServiceStatusCommand(interaction, false),
      giveaway: () => handleGiveawayCommand(interaction)
    };

    if (interaction.commandName === 'refresh-panels') {
      if (!memberIsStaff(interaction.member)) {
        await interaction.reply({
          content: 'Hanya staff yang bisa refresh panel.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      await interaction.reply({
        content: 'Refresh panel dimulai di background. Cek panel lagi beberapa detik lagi.',
        flags: MessageFlags.Ephemeral
      });
      refreshPanelsInBackground(interaction.guild, 'Manual panel');
      return;
    }

    const handler = handlers[interaction.commandName];
    if (handler) await handler();
  }

  async function handleButton(interaction) {
    if (interaction.customId === 'verify:member') {
      await handleVerify(interaction);
      return;
    }

    if (interaction.customId.startsWith('ticket:create:')) {
      const [, , type, service] = interaction.customId.split(':');
      await createTicket(interaction, type, service || null);
      return;
    }

    const handlers = {
      'ticket:claim': () => claimTicket(interaction),
      'ticket:payment': () => interaction.reply(qrisReplyPayload({ ephemeral: false })),
      'payment:qris': () => interaction.reply(qrisReplyPayload({ ephemeral: true })),
      'ticket:complete': () => showCompleteModal(interaction),
      'ticket:close': () => closeTicket(interaction)
    };
    const handler = handlers[interaction.customId];
    if (handler) {
      await handler();
      return;
    }

    if (interaction.customId.startsWith('giveaway:join:')) {
      await handleGiveawayJoin(interaction, Number(interaction.customId.split(':').at(-1)));
    }
  }

  return async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand()) {
      await handleChatCommand(interaction);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:complete-modal:')) {
      await completeTicket(interaction);
    }
  };
}
