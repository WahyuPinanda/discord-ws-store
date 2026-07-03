export const ROLE = {
  owner: '👑 Owner',
  admin: '🛡️ Admin',
  middleman: '🤝 Middleman / Rekber Staff',
  creator: '🎬 Content Creator',
  booster: '🚀 Server Booster',
  customer: '🛒 Customer',
  client: '✅ Client',
  unverified: '🔒 Unverified'
};

export const TIER_ROLES = [
  { min: 50_000_000, name: '💎 Customer 50Jt+' },
  { min: 20_000_000, name: '💠 Customer 20Jt+' },
  { min: 10_000_000, name: '🔷 Customer 10Jt+' },
  { min: 5_000_000, name: '🔹 Customer 5Jt+' },
  { min: 1_000_000, name: '⭐ Customer 1Jt+' }
];

export const VERIFY_IMAGE_PATH = 'assets/ws-store-verify-banner.png';

export const SPAM_SETTINGS = {
  windowMs: 7_000,
  maxMessages: 5,
  rapidWindowMs: 2_500,
  rapidMaxMessages: 5,
  cleanupWindowMs: 15_000,
  warningExpiresMs: 5 * 60_000,
  timeoutMs: 5 * 60_000
};

export const SERVICE_DEFINITIONS = {
  order: {
    label: 'ORDER',
    statsLabel: 'Ticket Order',
    panelType: 'ticket_order',
    showInStats: false
  },
  rekber: {
    label: 'REKBER',
    statsLabel: 'Ticket Rekber',
    panelType: 'ticket_rekber',
    showInStats: false
  },
  support: {
    label: 'SUPPORT',
    statsLabel: 'Ticket Support',
    panelType: 'ticket_support',
    showInStats: false
  },
  limited: {
    label: 'LIMITED',
    statsLabel: 'limited',
    statsEmoji: '💎',
    showInStats: true
  },
  'via-login': {
    label: 'VIA LOGIN',
    statsLabel: 'via-login',
    statsEmoji: '🧁',
    showInStats: true
  },
  'group-payout': {
    label: 'GROUP PAYOUT',
    statsLabel: 'grup-payout',
    statsEmoji: '💳',
    showInStats: true
  },
  'gift-gamepass': {
    label: 'GIFT GAMEPASS',
    statsLabel: 'gift-gamepass',
    statsEmoji: '🎮',
    showInStats: true
  }
};

export const TICKET_SERVICE_TYPES = new Set(['order', 'rekber', 'support']);

export const CATEGORY = {
  stats: '📊 SERVER STATS 📊',
  gate: '👋 WINNER STORE GATE',
  info: '📌 INFORMATION',
  market: '💎 MARKET & PRICE',
  ticket: '🎟️ ORDER / BERTANYA DISINI',
  activeTicket: '🎫 ACTIVE TICKETS',
  lounge: '💬 LOUNGE',
  community: '🎉 COMMUNITY',
  transaction: '📂 TRANSACTION',
  admin: '🔐 ADMIN AREA'
};

export const CHANNEL = {
  verify: '✅・verify',
  welcome: '👋・welcome',
  rules: '📜・rules',
  howToOrder: '📌・how-to-order',
  payment: '💳・payment-method',
  ticketOrder: '🎟️・ticket-order',
  ticketRekber: '🤝・ticket-rekber',
  ticketSupport: '🛠️・ticket-support',
  valueUpdate: '🔎・value-update-realtime',
  robuxViaUsername: '💎・robux-via-username',
  giveaways: '🎉・giveaways',
  successTransaction: '✅・success-transaction',
  ticketTranscript: '📜・ticket-transcript',
  adminLog: '📋・admin-log',
  ticketLog: '🎫・ticket-log'
};
