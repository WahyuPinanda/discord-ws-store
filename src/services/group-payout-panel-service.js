import { attachBanner, buyRobuxRow } from './market-panel-utils.js';

const GROUP_PAYOUT_IMAGE_PATH = 'assets/ws-store-group-payout.png';

const COMMUNITY_LINKS = [
  {
    label: 'Komunitas 1',
    url: 'https://www.roblox.com/communities/1064667246/BEJIRLAH-Community'
  },
  {
    label: 'Komunitas 2',
    url: 'https://www.roblox.com/id/communities/1108229986/Vandamoy'
  },
  {
    label: 'Komunitas 3',
    url: 'https://www.roblox.com/groups/654669898'
  }
];

const PAYOUT_AMOUNTS = [100, 500, 1_000, 2_000, 5_000, 10_000];
const RATE_PER_ROBUX = 120;
const RUPIAH_FORMATTER = new Intl.NumberFormat('id-ID');

function formatRupiah(value) {
  return `Rp ${RUPIAH_FORMATTER.format(value)}`;
}

function communityLinkRows() {
  return COMMUNITY_LINKS.flatMap(({ label, url }) => [`**${label}:**`, url, '']);
}

function payoutPriceRows() {
  return PAYOUT_AMOUNTS.map((amount) =>
    `${amount} 🪙 ➤ ${formatRupiah(amount * RATE_PER_ROBUX)}`
  );
}

const DEFAULT_GROUP_PAYOUT_DESCRIPTION = [
  '**Pengiriman Robux Langsung (Tanpa Login/Pending) ✅**',
  'Robux dikirim langsung ke saldo akun melalui sistem Payout Community Roblox kami. **SYARAT WAJIB:** Sesuai kebijakan Roblox, kamu **wajib sudah bergabung (Join) di Community kami minimal 14 hari** agar sistem mengizinkan proses payout.',
  '',
  '**Link Grup Komunitas:**',
  ...communityLinkRows(),
  `**Rate: ${formatRupiah(RATE_PER_ROBUX)} / 1 Robux**`,
  ...payoutPriceRows()
].join('\n');

export function groupPayoutPricePayload(embedBase, override = {}) {
  const payload = {
    embeds: [
      embedBase()
        .setTitle(override.title || '💸 PRICE LIST VIA PAYOUT COMMUNITY (INSTANT)')
        .setDescription(override.description || DEFAULT_GROUP_PAYOUT_DESCRIPTION)
    ],
    components: [buyRobuxRow('group-payout')]
  };

  return attachBanner(payload, GROUP_PAYOUT_IMAGE_PATH, 'ws-store-group-payout.png');
}
