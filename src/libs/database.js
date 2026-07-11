import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { unwrapSupabase } from './supabase-result.js';

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
  unwrapSupabase(await supabase
    .from('bot_heartbeat')
    .upsert({
      id: 'ws-store',
      last_ping: new Date().toISOString(),
      note: 'Daily bot heartbeat for WS Store Official'
    }), 'Supabase heartbeat update failed');

  unwrapSupabase(
    await supabase.from('customers').select('discord_user_id').limit(1),
    'Supabase heartbeat read failed'
  );
}
