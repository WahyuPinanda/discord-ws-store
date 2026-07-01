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

export const config = {
  discordToken: process.env.DISCORD_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  guildId: process.env.DISCORD_GUILD_ID,
  ownerDiscordId: process.env.OWNER_DISCORD_ID,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: supabaseSecretKey,
  storeName: process.env.STORE_NAME || 'WS Store Official',
  timezone: process.env.STORE_TIMEZONE || 'Asia/Makassar',
  openHour: Number(process.env.STORE_OPEN_HOUR || 10),
  closeHour: Number(process.env.STORE_CLOSE_HOUR || 22),
  qrisImagePath: process.env.QRIS_IMAGE_PATH || 'assets/qris-ws-store.png'
};
