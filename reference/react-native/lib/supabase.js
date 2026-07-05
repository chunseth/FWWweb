import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { backendConfig, isBackendConfigured } from "../config/backend";

let supabaseClient = null;

export const getSupabaseClient = () => {
  if (!isBackendConfigured()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(
      backendConfig.supabaseUrl,
      backendConfig.supabaseAnonKey,
      {
        auth: {
          storage: AsyncStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      }
    );
  }

  return supabaseClient;
};

export const ensureSupabaseSession = async () => {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { ok: false, reason: "backend_not_configured", session: null };
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    return { ok: false, reason: "session_lookup_failed", error: sessionError };
  }

  if (session?.user) {
    return { ok: true, session };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    return { ok: false, reason: "anonymous_sign_in_failed", error };
  }

  return { ok: true, session: data.session ?? null };
};
