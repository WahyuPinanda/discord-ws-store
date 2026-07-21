import { Events } from 'discord.js';

export function registerDiscordEventRoutes({
  client,
  handleMessageCreate,
  handleGuildMemberAdd,
  handleGuildMemberUpdate,
  handleInviteCreate,
  handleInviteDelete,
  handleInteraction,
  logger = console
}) {
  function safeEventHandler(eventName, handler) {
    return async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        logger.error(`${eventName} handler failed:`, error);
      }
    };
  }

  client.on(Events.MessageCreate, safeEventHandler('messageCreate', handleMessageCreate));
  client.on(Events.GuildMemberAdd, safeEventHandler('guildMemberAdd', handleGuildMemberAdd));
  client.on(Events.GuildMemberUpdate, safeEventHandler('guildMemberUpdate', handleGuildMemberUpdate));
  client.on(Events.InviteCreate, safeEventHandler('inviteCreate', handleInviteCreate));
  client.on(Events.InviteDelete, safeEventHandler('inviteDelete', handleInviteDelete));
  client.on(Events.InteractionCreate, handleInteraction);
}
