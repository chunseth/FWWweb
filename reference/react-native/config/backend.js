import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@env";

export const backendConfig = {
  supabaseUrl: SUPABASE_URL ?? "",
  supabaseAnonKey: SUPABASE_ANON_KEY ?? "",
};

export const isBackendConfigured = () =>
  backendConfig.supabaseUrl.trim().length > 0 &&
  backendConfig.supabaseAnonKey.trim().length > 0;
