import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { existsSync } from 'node:fs';

export function buyRobuxRow(service) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ticket:create:order:${service}`)
      .setLabel('Buy Robux')
      .setEmoji('🪙')
      .setStyle(ButtonStyle.Success)
  );
}

export function attachBanner(payload, imagePath, fileName) {
  if (!existsSync(imagePath)) return payload;

  payload.embeds[0].setImage(`attachment://${fileName}`);
  payload.files = [new AttachmentBuilder(imagePath, { name: fileName })];
  return payload;
}

export function separatedLinks(links) {
  return links.flatMap((link, index) => (index === 0 ? [link] : ['', link]));
}
