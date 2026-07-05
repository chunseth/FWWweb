import { describe, expect, it } from "vitest";
import { generateRushSeed, isRushSeed } from "../rushSeed";

describe("generateRushSeed", () => {
  it("returns exactly six digits", () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRushSeed()).toMatch(/^\d{6}$/);
    }
  });
});

describe("isRushSeed", () => {
  it("accepts six-digit strings only", () => {
    expect(isRushSeed("042837")).toBe(true);
    expect(isRushSeed("999999")).toBe(true);
    expect(isRushSeed("abcdef")).toBe(false);
    expect(isRushSeed("12345")).toBe(false);
    expect(isRushSeed("1234567")).toBe(false);
  });
});
