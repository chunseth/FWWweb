import { beforeAll, describe, expect, it } from "vitest";
import { dictionary } from "../dictionary";

describe("dictionary validation", () => {
  beforeAll(async () => {
    await dictionary.load();
  });

  it("rejects known invalid inflections like evokered", () => {
    expect(dictionary.isValid("evokered")).toBe(false);
    expect(dictionary.isValid("EVOKERED")).toBe(false);
    expect(dictionary.isValid("evokering")).toBe(false);
  });

  it("still accepts standard forms like evoked", () => {
    expect(dictionary.isValid("evoked")).toBe(true);
    expect(dictionary.isValid("brokenly")).toBe(true);
    expect(dictionary.isValid("cleverly")).toBe(true);
    expect(dictionary.isValid("happier")).toBe(true);
    expect(dictionary.isValid("happyer")).toBe(false);
    expect(dictionary.isValid("dryer")).toBe(true);
    expect(dictionary.isValid("fryer")).toBe(true);
    expect(dictionary.isValid("buyer")).toBe(true);
    expect(dictionary.isValid("flyer")).toBe(true);
    expect(dictionary.isValid("pryer")).toBe(true);
  });

  it("accepts Scrabble-valid borrowed words missing from the base list", () => {
    [
      "banhmi",
      "beorn",
      "chutzpah",
      "clept",
      "doth",
      "emoji",
      "hijab",
      "jalapeno",
      "kimchi",
      "mickle",
      "naan",
      "nerdy",
      "qapiks",
      "sashimi",
      "sheqel",
      "tandoori",
      "wey",
      "wis",
      "wynn",
      "yclept",
      "yarmulke",
    ].forEach((word) => {
      expect(dictionary.isValid(word)).toBe(true);
      expect(dictionary.isValid(word.toUpperCase())).toBe(true);
    });
  });
});
