import { describe, expect, it } from "vitest";
import {
  AUTOSAVE_KEY,
  clearAutosave,
  extractDraftPlacements,
  isValidSnapshot,
  loadAutosave,
  saveAutosave,
  toStableSnapshot,
} from "../autosave";
import type { StorageLike } from "../autosave";
import { createRushRun, placeTile } from "../rushEngine";
import type { RushSnapshot } from "../../shared/types";

const makeStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const place = (state: RushSnapshot, rackIndex: number, row: number, col: number) => {
  const result = placeTile(state, rackIndex, row, col, "Z");
  if (!result.ok) throw new Error(result.error.text);
  return result.state;
};

describe("autosave round trip", () => {
  it("saves and restores a stable snapshot", () => {
    const storage = makeStorage();
    const state = createRushRun("save-seed", 1000);
    expect(saveAutosave(state, storage)).toBe(true);

    const restored = loadAutosave(storage);
    expect(restored).not.toBeNull();
    expect(restored!.state).toEqual(state);
    expect(restored!.draftRestored).toBe(false);
  });

  it("saves and restores draft placements", () => {
    const storage = makeStorage();
    let state = createRushRun("save-seed", 1000);
    state = place(state, 0, 5, 5);
    state = place(state, 2, 5, 6);

    saveAutosave(state, storage);
    const restored = loadAutosave(storage);
    expect(restored).not.toBeNull();
    expect(restored!.draftRestored).toBe(true);
    expect(restored!.state.board[5][5]?.letter).toBe(state.board[5][5]?.letter);
    expect(restored!.state.board[5][6]?.letter).toBe(state.board[5][6]?.letter);
    expect(restored!.state.board[5][5]?.rackIndex).toBe(0);
  });

  it("separates stable and draft layers", () => {
    let state = createRushRun("save-seed", 1000);
    state = place(state, 0, 5, 5);

    const stable = toStableSnapshot(state);
    expect(stable.board[5][5]).toBeNull();

    const draft = extractDraftPlacements(state);
    expect(draft).toEqual([{ row: 5, col: 5, rackIndex: 0 }]);
  });
});

describe("corrupt autosave recovery", () => {
  it("returns null for garbage JSON", () => {
    const storage = makeStorage();
    storage.setItem(AUTOSAVE_KEY, "{not json!!!");
    expect(loadAutosave(storage)).toBeNull();
  });

  it("returns null for a wrong schema version", () => {
    const storage = makeStorage();
    const state = createRushRun("save-seed", 1000);
    saveAutosave(state, storage);
    const payload = JSON.parse(storage.getItem(AUTOSAVE_KEY)!);
    payload.schemaVersion = 999;
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    expect(loadAutosave(storage)).toBeNull();
  });

  it("returns null for a structurally invalid stable snapshot", () => {
    const storage = makeStorage();
    const state = createRushRun("save-seed", 1000);
    saveAutosave(state, storage);
    const payload = JSON.parse(storage.getItem(AUTOSAVE_KEY)!);
    payload.stable.board = "not a board";
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    expect(loadAutosave(storage)).toBeNull();
  });

  it("falls back to the stable snapshot when the draft is invalid", () => {
    const storage = makeStorage();
    const state = createRushRun("save-seed", 1000);
    saveAutosave(state, storage);
    const payload = JSON.parse(storage.getItem(AUTOSAVE_KEY)!);
    payload.draft = [{ row: 5, col: 5, rackIndex: 99 }]; // impossible index
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));

    const restored = loadAutosave(storage);
    expect(restored).not.toBeNull();
    expect(restored!.draftDiscarded).toBe(true);
    expect(restored!.state).toEqual(state);
  });

  it("never crashes on adversarial payloads", () => {
    const storage = makeStorage();
    const junk = [
      "null",
      "[]",
      "{}",
      '{"schemaVersion":1}',
      '{"schemaVersion":1,"stable":{"seed":123}}',
      '{"schemaVersion":1,"stable":{"seed":"x","board":[[]]}}',
    ];
    for (const value of junk) {
      storage.setItem(AUTOSAVE_KEY, value);
      expect(() => loadAutosave(storage)).not.toThrow();
      expect(loadAutosave(storage)).toBeNull();
    }
  });
});

describe("isValidSnapshot", () => {
  it("accepts a freshly created run", () => {
    expect(isValidSnapshot(createRushRun("seed", 1000))).toBe(true);
  });

  it("accepts a 10-minute classic run", () => {
    expect(
      isValidSnapshot(createRushRun("classic-seed", 1000, { durationSeconds: 600 }))
    ).toBe(true);
  });

  it("rejects tampered timers", () => {
    const state = createRushRun("seed", 1000);
    expect(isValidSnapshot({ ...state, elapsedMs: -5 })).toBe(false);
    expect(isValidSnapshot({ ...state, elapsedMs: 10_000_000 })).toBe(false);
    expect(isValidSnapshot({ ...state, durationSeconds: 999 })).toBe(false);
    expect(isValidSnapshot({ ...state, boardSize: 15 })).toBe(false);
    expect(
      isValidSnapshot({
        ...createRushRun("classic-seed", 1000, { durationSeconds: 600 }),
        durationSeconds: 300,
      })
    ).toBe(false);
  });
});

describe("clearAutosave", () => {
  it("removes the save", () => {
    const storage = makeStorage();
    saveAutosave(createRushRun("seed", 1000), storage);
    clearAutosave(storage);
    expect(loadAutosave(storage)).toBeNull();
  });
});
