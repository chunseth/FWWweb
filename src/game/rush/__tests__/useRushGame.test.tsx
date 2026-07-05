import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTOSAVE_KEY, loadAutosave } from "../autosave";
import { LOCAL_RESULTS_KEY } from "../localResults";
import { RUSH_DURATION_MS } from "../rushEngine";
import { useRushGame } from "../useRushGame";
import type { DictionaryLike } from "../../shared/types";

const acceptAll: DictionaryLike = { isValid: () => true };

const renderGame = () =>
  renderHook(() => useRushGame({ dictionary: acceptAll }));

/** Place the first two rack tiles across the center to form a valid line. */
const playFirstWord = (
  result: { current: ReturnType<typeof useRushGame> }
) => {
  act(() => {
    result.current.placeRackTile(0, 5, 5, "Z");
  });
  act(() => {
    result.current.placeRackTile(1, 5, 6, "Z");
  });
  act(() => {
    result.current.submitWord();
  });
};

describe("useRushGame", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a new active run and writes an autosave", () => {
    const { result } = renderGame();
    expect(result.current.state).toBeNull();

    act(() => {
      result.current.startNewRun();
    });

    expect(result.current.state?.status).toBe("active");
    expect(result.current.state?.rack).toHaveLength(7);
    expect(localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();
  });

  it("submits a word: score, journal, autosave update", () => {
    const { result } = renderGame();
    act(() => {
      result.current.startNewRun();
    });

    playFirstWord(result);

    expect(result.current.state?.turnCount).toBe(1);
    expect(result.current.state?.journal).toHaveLength(1);
    expect(result.current.runningScore).toBeGreaterThan(0);
    expect(result.current.message?.kind).toBe("success");

    const saved = loadAutosave();
    expect(saved?.state.turnCount).toBe(1);
  });

  it("rejects an invalid submit with an error message", () => {
    const { result } = renderGame();
    act(() => {
      result.current.startNewRun();
    });
    act(() => {
      result.current.submitWord();
    });
    expect(result.current.message?.kind).toBe("error");
    expect(result.current.state?.turnCount).toBe(0);
  });

  it("swaps tiles with a penalty", () => {
    const { result } = renderGame();
    act(() => {
      result.current.startNewRun();
    });
    act(() => {
      result.current.swapTiles([0, 1]);
    });
    expect(result.current.state?.swapCount).toBe(1);
    expect(result.current.state?.turnCount).toBe(1);
  });

  it("expires the run when the timer hits zero and records a local result", () => {
    const { result } = renderGame();
    act(() => {
      result.current.startNewRun();
    });
    playFirstWord(result);

    act(() => {
      vi.advanceTimersByTime(RUSH_DURATION_MS + 1000);
    });

    expect(result.current.state?.status).toBe("expired");
    expect(result.current.state?.finalBreakdown).not.toBeNull();
    expect(result.current.remainingMs).toBe(0);
    // Autosave cleared, result recorded as local-only.
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    const results = JSON.parse(localStorage.getItem(LOCAL_RESULTS_KEY)!);
    expect(results).toHaveLength(1);
    expect(results[0].eligibility).toBe("local_only");
  });

  it("resumes a saved run with draft placements after an unmount (refresh)", () => {
    const first = renderGame();
    act(() => {
      first.result.current.startNewRun();
    });
    playFirstWord(first.result);

    // Draft placement, then let the debounced draft save fire.
    act(() => {
      first.result.current.placeRackTile(0, 6, 5, "Z");
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const committedTurns = first.result.current.state!.turnCount;
    const draftLetter = first.result.current.state!.board[6][5]?.letter;
    first.unmount();

    const second = renderGame();
    expect(second.result.current.savedRunAvailable).toBe(true);

    act(() => {
      second.result.current.resumeSavedRun();
    });
    expect(second.result.current.state?.status).toBe("active");
    expect(second.result.current.state?.turnCount).toBe(committedTurns);
    expect(second.result.current.state?.board[6][5]?.letter).toBe(draftLetter);
  });

  it("expires immediately on resume when the saved clock is already spent", () => {
    const first = renderGame();
    act(() => {
      first.result.current.startNewRun();
    });
    playFirstWord(first.result);

    // Manually age the autosave clock to the full duration.
    const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY)!);
    raw.stable.elapsedMs = RUSH_DURATION_MS;
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(raw));
    first.unmount();

    const second = renderGame();
    act(() => {
      second.result.current.resumeSavedRun();
    });
    expect(second.result.current.state?.status).toBe("expired");
    expect(second.result.current.state?.finalBreakdown).not.toBeNull();
  });

  it("ignores a corrupt autosave instead of crashing", () => {
    localStorage.setItem(AUTOSAVE_KEY, '{"schemaVersion":1,"stable":"junk"}');
    const { result } = renderGame();
    expect(result.current.savedRunAvailable).toBe(false);
    expect(result.current.resumeSavedRun()).toBe(false);
  });

  it("discards a saved run on request", () => {
    const first = renderGame();
    act(() => {
      first.result.current.startNewRun();
    });
    first.unmount();

    const second = renderGame();
    expect(second.result.current.savedRunAvailable).toBe(true);
    act(() => {
      second.result.current.discardSavedRun();
    });
    expect(second.result.current.savedRunAvailable).toBe(false);
    expect(localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });
});
