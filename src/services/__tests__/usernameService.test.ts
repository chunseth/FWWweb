import { beforeEach, describe, expect, it, vi } from "vitest";

// Hermetic: ignore any developer .env so no real network is attempted.
vi.mock("../supabaseClient", () => ({
  isBackendConfigured: () => false,
  getSupabaseClient: () => null,
}));
import {
  checkUsername,
  clearProfile,
  loadProfile,
  saveProfile,
  validateUsernameFormat,
} from "../usernameService";

describe("validateUsernameFormat", () => {
  it("mirrors the database constraints (3-20, [A-Za-z0-9_])", () => {
    expect(validateUsernameFormat("ab")).not.toBeNull();
    expect(validateUsernameFormat("abc")).toBeNull();
    expect(validateUsernameFormat("a".repeat(20))).toBeNull();
    expect(validateUsernameFormat("a".repeat(21))).not.toBeNull();
    expect(validateUsernameFormat("Player_1")).toBeNull();
    expect(validateUsernameFormat("bad name")).not.toBeNull();
    expect(validateUsernameFormat("bad-name")).not.toBeNull();
    expect(validateUsernameFormat("émoji")).not.toBeNull();
    expect(validateUsernameFormat("  padded  ")).toBeNull(); // trimmed
  });
});

describe("checkUsername without a configured backend", () => {
  it("accepts a valid name as unverified (local fallback)", async () => {
    const result = await checkUsername("SoloPlayer");
    expect(result.status).toBe("unverified");
  });

  it("rejects an invalid name outright", async () => {
    const result = await checkUsername("x");
    expect(result.status).toBe("invalid");
  });
});

describe("profile storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a profile", () => {
    saveProfile({ username: "Seth_5", verified: true, savedAtMs: 42 });
    const loaded = loadProfile();
    expect(loaded?.username).toBe("Seth_5");
    expect(loaded?.verified).toBe(true);
  });

  it("drops a stored profile with an invalid name", () => {
    localStorage.setItem(
      "fwwweb.profile.v1",
      JSON.stringify({ username: "no spaces here", verified: true })
    );
    expect(loadProfile()).toBeNull();
  });

  it("clears the profile", () => {
    saveProfile({ username: "Seth_5", verified: false, savedAtMs: 42 });
    clearProfile();
    expect(loadProfile()).toBeNull();
  });
});
