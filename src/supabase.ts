import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const ROOM_ID = (import.meta.env.VITE_ROOM_ID as string | undefined) || 'mossbell-courtyard';

let cached: SupabaseClient | null = null;

export function supabaseConfig(): { url: string; key: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url || !key) return null;
  return { url, key };
}

export function getSupabase(): SupabaseClient | null {
  const config = supabaseConfig();
  if (!config) return null;
  if (!cached) {
    cached = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cached;
}
