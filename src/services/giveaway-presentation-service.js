import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  time,
  TimestampStyles
} from 'discord.js';
import { ROLE, TIER_ROLES, VERIFIED_ROLE_ALIASES } from '../config/constants.js';

export const GIVEAWAY_ENTRY_ROLES = [
  { role: TIER_ROLES[0].name, entries: 12 },
  { role: TIER_ROLES[1].name, entries: 8 },
  { role: TIER_ROLES[2].name, entries: 6 },
  { role: TIER_ROLES[3].name, entries: 4 },
  { role: TIER_ROLES[4].name, entries: 2 },
  { role: ROLE.client, entries: 1 },
  ...VERIFIED_ROLE_ALIASES.map((role) => ({ role, entries: 1 }))
];

export function parseGiveawayDurationMs(value) {
  const match = String(value || '').trim().toLowerCase().match(/^(\d+)\s*(m|h|d)$/);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) return null;
  const multipliers = {
    m: 60_000,
    h: 60 * 60_000,
    d: 24 * 60 * 60_000
  };
  const duration = amount * multipliers[match[2]];
  return duration <= 365 * 24 * 60 * 60_000 ? duration : null;
}

export function giveawayEntriesForMember(member, rules = GIVEAWAY_ENTRY_ROLES) {
  return rules.reduce((highest, rule) => (
    member.roles.cache.some((role) => role.name === rule.role)
      ? Math.max(highest, rule.entries)
      : highest
  ), 0);
}

export function pickWeightedWinners(entries, winnersCount, random = Math.random) {
  const candidates = [...entries];
  const winners = [];
  while (candidates.length && winners.length < winnersCount) {
    const totalWeight = candidates.reduce((total, entry) => total + entry.entries, 0);
    let target = random() * totalWeight;
    let pickedIndex = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      target -= candidates[index].entries;
      if (target < 0) {
        pickedIndex = index;
        break;
      }
    }
    winners.push(candidates[pickedIndex]);
    candidates.splice(pickedIndex, 1);
  }

  return winners;
}

export function createGiveawayPresentationService({
  embedBase,
  entryRules = GIVEAWAY_ENTRY_ROLES
}) {
  function joinRow(giveawayId, disabled = false) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway:join:${giveawayId}`)
        .setLabel('Ikut Giveaway')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled)
    );
  }

  function rulesText(guild) {
    return entryRules
      .map((rule) => {
        const role = guild.roles.cache.find((item) => item.name === rule.role);
        return `• ${role ? `<@&${role.id}>` : rule.role} = ${rule.entries} ticket`;
      })
      .join('\n');
  }

  function payload(guild, giveaway, participantCount, winners = []) {
    const ended = giveaway.status === 'ended';
    const endsAt = new Date(giveaway.ends_at);
    const winnerText = winners.length
      ? winners.map((winner) => `<@${winner.user_id}>`).join(', ')
      : 'Belum diundi';

    return {
      embeds: [
        embedBase()
          .setTitle(giveaway.prize)
          .setDescription([
            `• Giveaway ID: ${giveaway.id}`,
            `• Hosted by: <@${giveaway.host_id}>`,
            `• Ended at: ${time(endsAt, TimestampStyles.ShortDateTime)} (${time(endsAt, TimestampStyles.RelativeTime)})`,
            `• Winners: ${giveaway.winners_count}`,
            '',
            `• Participants: ${participantCount}`,
            '',
            '**Roles with entries:**',
            rulesText(guild),
            '',
            ended
              ? `⏰ Giveaway sudah selesai. Winner: ${winnerText}`
              : 'Klik tombol di bawah untuk ikut giveaway.'
          ].join('\n'))
      ],
      components: [joinRow(giveaway.id, ended)]
    };
  }

  return { payload };
}
