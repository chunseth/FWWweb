/**
 * Browser Supabase client. Configured via Vite env:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 *
 * Only the anon key ever ships to the browser. Score submission stays OFF the
 * client per AGENT.md — this client is used for read-side checks (username
 * availability) until the hardened server path exists.
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let initialized = false;

export const isBackendConfigured = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return Boolean(url && url.trim() && key && key.trim());
};

export const getSupabaseClient = (): SupabaseClient | null => {
  if (initialized) return client;
  initialized = true;
  if (!isBackendConfigured()) return null;
  client = createClient(
    (import.meta.env.VITE_SUPABASE_URL as string).trim(),
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string).trim(),
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    }
  );
  return client;
};
