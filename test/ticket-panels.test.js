import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';
import { createTicketPanelFeature } from '../src/features/ticket-panels.js';

const services = [
  { service: 'gift-gamepass', label: 'Gamepass & GIG', emoji: '🎁', description: 'Gamepass.' },
  { service: 'group-payout', label: 'Payout Instant', emoji: '💸', description: 'Payout.' },
  { service: 'via-login', label: 'VILOG', emoji: '⚡', description: 'Login.' },
  { service: 'via-username', label: 'Robux Via Username', emoji: '🆔', description: 'Username.' },
  { service: 'limited', label: 'Limited Item', emoji: '💎', description: 'Limited.' }
];

test('order panel uses effective gate status and raw service statuses', () => {
  const openServices = new Set(['gift-gamepass', 'via-login', 'limited']);
  const feature = createTicketPanelFeature({
    config: {
      guildId: 'guild-1',
      openHour: 10,
      closeHour: 22,
      timezoneLabel: 'WIB'
    },
    embedBase: () => new EmbedBuilder().setColor(0x2ecc71),
    operatingStatusText: () => 'OPEN',
    orderTicketServices: services,
    rekberImagePath: 'missing.png',
    orderTicketServiceIsAvailable: (_guildId, service) => openServices.has(service),
    serviceIsOpen: (_guildId, service) => openServices.has(service),
    serviceStatusIsSet: () => false,
    ticketServiceIsAvailable: (_guildId, type) => type === 'order'
  });

  const payload = feature.ticketPanelPayload('order');
  const description = payload.embeds[0].data.description;
  const buttons = payload.components.flatMap((row) => row.components);
  const disabledById = Object.fromEntries(
    buttons.map((button) => [button.data.custom_id, button.data.disabled || false])
  );

  assert.match(description, /OPEN \| Gerbang Ticket Order/);
  assert.match(description, /Gamepass & GIG[\s\S]*Status: OPEN/);
  assert.match(description, /Payout Instant[\s\S]*Status: CLOSED/);
  assert.equal(disabledById['ticket:create:order:gift-gamepass'], false);
  assert.equal(disabledById['ticket:create:order:group-payout'], true);
  assert.equal(disabledById['ticket:create:order:limited'], false);
});

test('closed order gate disables every service button', () => {
  const feature = createTicketPanelFeature({
    config: {
      guildId: 'guild-1',
      openHour: 10,
      closeHour: 22,
      timezoneLabel: 'WIB'
    },
    embedBase: () => new EmbedBuilder().setColor(0x2ecc71),
    operatingStatusText: () => 'CLOSED',
    orderTicketServices: services,
    rekberImagePath: 'missing.png',
    orderTicketServiceIsAvailable: () => false,
    serviceIsOpen: () => true,
    serviceStatusIsSet: () => false,
    ticketServiceIsAvailable: () => false
  });

  const payload = feature.ticketPanelPayload('order');
  const buttons = payload.components.flatMap((row) => row.components);

  assert.match(payload.embeds[0].data.description, /CLOSED \| Gerbang Ticket Order/);
  assert.equal(buttons.every((button) => button.data.disabled), true);
});
