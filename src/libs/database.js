import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  }
);

export async function keepSupabaseAwake() {
  await supabase
    .from('bot_heartbeat')
    .upsert({
      id: 'ws-store',
      last_ping: new Date().toISOString(),
      note: 'Daily bot heartbeat for WS Store Official'
    });

  await supabase.from('customers').select('discord_user_id').limit(1);
}
