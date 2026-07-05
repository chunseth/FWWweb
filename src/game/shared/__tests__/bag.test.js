import {
  createShuffledTileBag,
  hashSeed,
  initializeMiniTileBag,
} from "../bag";

describe("bag seed hashing", () => {
  it("does not map adjacent daily seeds to adjacent hash values", () => {
    const march1 = hashSeed("20260301");
    const march2 = hashSeed("20260302");
    const march3 = hashSeed("20260303");

    expect(Math.abs(march1 - march2)).toBeGreaterThan(1_000_000);
    expect(Math.abs(march2 - march3)).toBeGreaterThan(1_000_000);
  });

  it("produces deterministic shuffled bags for the same seed", () => {
    const first = createShuffledTileBag("20260301").tileBag
      .slice(-7)
      .map((tile) => tile.letter)
      .join("");
    const second = createShuffledTileBag("20260301").tileBag
      .slice(-7)
      .map((tile) => tile.letter)
      .join("");

    expect(first).toBe(second);
  });

  it("builds a deterministic mini bag with rare-letter alternates and 48 tiles", () => {
    const firstBag = initializeMiniTileBag("20260321");
    const secondBag = initializeMiniTileBag("20260321");
    expect(firstBag).toEqual(secondBag);
    expect(firstBag).toHaveLength(48);

    const count = (letter) =>
      firstBag.filter((tile) => tile.letter === letter).length;

    expect(count("O")).toBe(5);
    expect(count("S")).toBe(3);
    expect(count("Q") + count("Z")).toBe(1);
    expect(count("J") + count("X")).toBe(1);
    expect(count("Y")).toBe(1);
    expect(count("K")).toBe(1);
    if (count("Q") === 1) {
      expect(count("U")).toBe(3);
      expect(count("V") + count("W")).toBe(1);
    } else {
      expect(count("U")).toBe(2);
      expect(count("V")).toBe(1);
      expect(count("W")).toBe(1);
    }
  });
});
