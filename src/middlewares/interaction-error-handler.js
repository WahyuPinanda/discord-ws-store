import { MessageFlags } from 'discord.js';

export function withInteractionErrorHandling(handler, logger = console) {
  return async function handleInteractionSafely(interaction) {
    try {
      await handler(interaction);
    } catch (error) {
      logger.error(error);
      const message = 'Terjadi error di bot. Cek console/log server bot.';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => null);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
  };
}
