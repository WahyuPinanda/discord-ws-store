import 'dotenv/config';

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SUPABASE_URL'
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required env: ${key}`);
  }
}

const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseSecretKey) {
  throw new Error('Missing required env: SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY');
}

function parseHour(name, fallback, { allow24 = false } = {}) {
  const value = Number(process.env[name] ?? fallback);
  const maximum = allow24 ? 24 : 23;
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${name} must be an integer between 0 and ${maximum}`);
  }
  return value;
}

const timezone = process.env.STORE_TIMEZONE || 'Asia/Jakarta';
const openHour = parseHour('STORE_OPEN_HOUR', 10);
const closeHour = parseHour('STORE_CLOSE_HOUR', 22, { allow24: true });

if (openHour >= closeHour) {
  throw new Error('STORE_OPEN_HOUR must be earlier than STORE_CLOSE_HOUR');
}

try {
  new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
} catch {
  throw new Error(`STORE_TIMEZONE is invalid: ${timezone}`);
}

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  ownerDiscordId: process.env.OWNER_DISCORD_ID,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: supabaseSecretKey,
  storeName: process.env.STORE_NAME || 'WS Store Official',
  timezone,
  timezoneLabel: process.env.STORE_TIMEZONE_LABEL || 'WIB',
  openHour,
  closeHour,
  qrisImagePath: process.env.QRIS_IMAGE_PATH || 'assets/qris-ws-store.png'
};
