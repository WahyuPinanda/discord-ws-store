import assert from 'node:assert/strict';
import test from 'node:test';
import { EmbedBuilder } from 'discord.js';
import { createTicketPanelFeature } from '../src/services/ticket-panel-service.js';

const services = [
  { service: 'gift-gamepass', label: 'Gamepass & GIG', emoji: '🎁', description: 'Gamepass.' },
  { service: 'group-payout', label: 'Payout Instant', emoji: '💸', description: 'Payout.' },
  { service: 'via-login', label: 'VILOG', emoji: '⚡', description: 'Login.' },
  { service: 'via-username', label: 'Robux Via Username', emoji: '🆔', description: 'Username.' },
  { service: 'limited', label: 'Limited Item', emoji: '💎', description: 'Limited.' }
];

test('order panel uses the same effective status for text and buttons', () => {
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

  assert.equal(description.includes('Gerbang Ticket Order'), false);
  assert.equal(description.includes('mengikuti server stats masing-masing'), false);
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
  const description = payload.embeds[0].data.description;
  const buttons = payload.components.flatMap((row) => row.components);

  assert.equal(payload.embeds[0].data.description.includes('Gerbang Ticket Order'), false);
  assert.match(description, /Gamepass & GIG[\s\S]*Status: CLOSED/);
  assert.match(description, /Limited Item[\s\S]*Status: CLOSED/);
  assert.equal(buttons.every((button) => button.data.disabled), true);
});
