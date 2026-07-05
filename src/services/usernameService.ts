/**
 * Username selection with database-backed uniqueness.
 *
 * Format rules mirror the `public.profiles` constraints in
 * reference/supabase/schema.sql: 3-20 chars, [A-Za-z0-9_], unique on
 * lower(username).
 *
 * When Supabase is configured, availability is checked against `profiles`.
 * When it is not (or the network is down), the name is accepted locally and
 * marked unverified — the game stays playable, and verification can happen
 * when the hardened leaderboard path ships.
 */

import { getSupabaseClient } from "./supabaseClient";
import type { StorageLike } from "../game/rush/autosave";

export const PROFILE_KEY = "fwwweb.profile.v1";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export interface StoredProfile {
  username: string;
  /** True when uniqueness was confirmed against the database. */
  verified: boolean;
  savedAtMs: number;
}

export type UsernameCheck =
  | { status: "invalid"; reason: string }
  | { status: "taken" }
  | { status: "available"; verified: true }
  | { status: "unverified"; verified: false; reason: string };

export const validateUsernameFormat = (raw: string): string | null => {
  const name = raw.trim();
  if (name.length < USERNAME_MIN) {
    return `At least ${USERNAME_MIN} characters.`;
  }
  if (name.length > USERNAME_MAX) {
    return `At most ${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_PATTERN.test(name)) {
    return "Letters, numbers, and underscores only.";
  }
  return null;
};

/** Check availability against the profiles table (uniqueness on lowercase). */
export const checkUsername = async (raw: string): Promise<UsernameCheck> => {
  const name = raw.trim();
  const formatError = validateUsernameFormat(name);
  if (formatError) {
    return { status: "invalid", reason: formatError };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      status: "unverified",
      verified: false,
      reason: "Playing offline — name saved on this device.",
    };
  }

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", name)
      .limit(1);

    if (error) {
      return {
        status: "unverified",
        verified: false,
        reason: "Couldn't reach the server — name saved on this device.",
      };
    }
    if (Array.isArray(data) && data.length > 0) {
      return { status: "taken" };
    }
    return { status: "available", verified: true };
  } catch {
    return {
      status: "unverified",
      verified: false,
      reason: "Couldn't reach the server — name saved on this device.",
    };
  }
};

const defaultStorage = (): StorageLike | null => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* storage disabled */
  }
  return null;
};

export const loadProfile = (
  storage: StorageLike | null = defaultStorage()
): StoredProfile | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProfile>;
    if (
      typeof parsed.username !== "string" ||
      validateUsernameFormat(parsed.username) != null
    ) {
      return null;
    }
    return {
      username: parsed.username,
      verified: parsed.verified === true,
      savedAtMs:
        typeof parsed.savedAtMs === "number" ? parsed.savedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
};

export const saveProfile = (
  profile: StoredProfile,
  storage: StorageLike | null = defaultStorage()
): void => {
  try {
    storage?.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore quota errors */
  }
};

export const clearProfile = (
  storage: StorageLike | null = defaultStorage()
): void => {
  try {
    storage?.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
};
