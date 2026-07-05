/**
 * Web-native hook for the fixed 5-minute mini Rush run.
 *
 * React owns committed game state (a RushSnapshot from the pure engine).
 * The countdown ticks on an interval; live drag movement never goes through
 * this hook (see useTileDrag). Autosave runs after every committed event,
 * on a debounce for drafts, and periodically for the clock.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearAutosave,
  loadAutosave,
  saveAutosave,
} from "./autosave";
import { saveLocalResult } from "./localResults";
import {
  createRushRun,
  expireRun,
  finishRun,
  getRunningScore,
  getUsedRackIndices,
  moveBoardTile as engineMoveBoardTile,
  placeTile as enginePlaceTile,
  removeBoardTile as engineRemoveBoardTile,
  reorderRack as engineReorderRack,
  returnAllDraftTiles,
  shuffleRack as engineShuffleRack,
  submitTurn as engineSubmitTurn,
  swapTiles as engineSwapTiles,
  RUSH_DURATION_MS,
} from "./rushEngine";
import type { SubmitDetail } from "./rushEngine";
import { dictionary as defaultDictionary } from "../../utils/dictionary";
import type {
  DictionaryLike,
  RushSnapshot,
  ValidationError,
} from "../shared/types";

export interface UseRushGameOptions {
  /** Injectable dictionary (tests). Defaults to the app dictionary singleton. */
  dictionary?: DictionaryLike & {
    load?: () => Promise<void>;
    loaded?: boolean;
  };
}

const DRAFT_SAVE_DEBOUNCE_MS = 250;
const CLOCK_SAVE_INTERVAL_MS = 5000;
const TICK_MS = 200;

export interface GameMessage extends ValidationError {
  kind: "error" | "success";
  turnPoints?: number;
  consistencyBonus?: number;
  scrabbleBonusMessage?: string | null;
}

export interface UseRushGameResult {
  /** Committed state + current draft placements. Null before the first run. */
  state: RushSnapshot | null;
  remainingMs: number;
  runningScore: number;
  usedRackIndices: Set<number>;
  message: GameMessage | null;
  dictionaryReady: boolean;
  /** A resumable saved run exists (and no run is currently mounted). */
  savedRunAvailable: boolean;
  startNewRun: () => void;
  resumeSavedRun: () => boolean;
  discardSavedRun: () => void;
  placeRackTile: (
    rackIndex: number,
    row: number,
    col: number,
    blankLetter?: string | null
  ) => boolean;
  moveBoardTile: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) => boolean;
  removeBoardTile: (row: number, col: number) => boolean;
  returnTileToRack: (
    row: number,
    col: number,
    visibleIndex?: number | null
  ) => boolean;
  returnAllDrafts: () => void;
  reorderRack: (
    fromIndex: number,
    toIndex: number,
    releasedIndex?: number | null
  ) => void;
  shuffleRack: () => void;
  submitWord: () => SubmitDetail | null;
  swapTiles: (rackIndices: number[]) => boolean;
  dismissMessage: () => void;
  pauseClock: () => boolean;
  resumeClock: () => void;
}

export const useRushGame = (
  options: UseRushGameOptions = {}
): UseRushGameResult => {
  const dictionary = options.dictionary ?? defaultDictionary;
  const [state, setState] = useState<RushSnapshot | null>(null);
  const [remainingMs, setRemainingMs] = useState(RUSH_DURATION_MS);
  const [message, setMessage] = useState<GameMessage | null>(null);
  const [dictionaryReady, setDictionaryReady] = useState(
    dictionary.loaded ?? true
  );
  const [savedRunAvailable, setSavedRunAvailable] = useState(false);

  const stateRef = useRef<RushSnapshot | null>(null);
  stateRef.current = state;

  /** Elapsed active ms at the moment the in-memory clock last (re)started. */
  const baseElapsedRef = useRef(0);
  /** Wall-clock ms when the in-memory clock last (re)started; null if stopped. */
  const runningSinceRef = useRef<number | null>(null);
  const resultSavedRef = useRef(false);
  const draftSaveTimerRef = useRef<number | null>(null);

  const getElapsedMs = useCallback((): number => {
    const base = baseElapsedRef.current;
    const since = runningSinceRef.current;
    const elapsed = since == null ? base : base + (Date.now() - since);
    return Math.min(elapsed, RUSH_DURATION_MS);
  }, []);

  const startClockIfNeeded = useCallback(() => {
    if (runningSinceRef.current != null) return;
    runningSinceRef.current = Date.now();
  }, []);

  /** Freeze the countdown (pause menu). No-op if the clock never started. */
  const pauseClock = useCallback((): boolean => {
    if (runningSinceRef.current == null) return false;
    baseElapsedRef.current = Math.min(
      baseElapsedRef.current + (Date.now() - runningSinceRef.current),
      RUSH_DURATION_MS
    );
    runningSinceRef.current = null;
    const current = stateRef.current;
    if (current && current.status === "active") {
      saveAutosave({ ...current, elapsedMs: baseElapsedRef.current });
    }
    return true;
  }, []);

  /** Resume a paused countdown. Only restarts a clock that had started. */
  const resumeClock = useCallback(() => {
    const current = stateRef.current;
    if (!current || current.status !== "active") return;
    if (runningSinceRef.current != null) return;
    if (baseElapsedRef.current <= 0) return; // first move will start it
    runningSinceRef.current = Date.now();
  }, []);

  const dictionaryRef = useRef(dictionary);
  dictionaryRef.current = dictionary;

  // Load the dictionary once, up front.
  useEffect(() => {
    const dict = dictionaryRef.current;
    if (!dict.load) {
      setDictionaryReady(true);
      return;
    }
    let cancelled = false;
    dict
      .load()
      .then(() => {
        if (!cancelled) setDictionaryReady(true);
      })
      .catch(() => {
        if (!cancelled) setDictionaryReady(dict.loaded ?? false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Detect a resumable autosave on mount.
  useEffect(() => {
    const restored = loadAutosave();
    setSavedRunAvailable(restored != null && restored.state.status === "active");
  }, []);

  const persist = useCallback((snapshot: RushSnapshot, elapsedMs: number) => {
    saveAutosave({ ...snapshot, elapsedMs });
  }, []);

  const scheduleDraftSave = useCallback(() => {
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      const current = stateRef.current;
      if (current && current.status === "active") {
        persist(current, getElapsedMs());
      }
    }, DRAFT_SAVE_DEBOUNCE_MS);
  }, [getElapsedMs, persist]);

  const finishAndRecord = useCallback(
    (finished: RushSnapshot) => {
      setState(finished);
      runningSinceRef.current = null;
      baseElapsedRef.current = finished.elapsedMs;
      setRemainingMs(Math.max(0, RUSH_DURATION_MS - finished.elapsedMs));
      clearAutosave();
      if (!resultSavedRef.current && finished.finalBreakdown) {
        resultSavedRef.current = true;
        saveLocalResult({
          seed: finished.seed,
          completedAtMs: Date.now(),
          eligibility: finished.eligibility,
          breakdown: finished.finalBreakdown,
          wordCount: finished.wordCount,
          turnCount: finished.turnCount,
        });
      }
    },
    []
  );

  // Countdown tick + expiry.
  useEffect(() => {
    if (!state || state.status !== "active") return;

    const tick = () => {
      const elapsed = getElapsedMs();
      const remaining = Math.max(0, RUSH_DURATION_MS - elapsed);
      setRemainingMs(remaining);
      if (remaining <= 0) {
        const current = stateRef.current;
        if (current && current.status === "active") {
          finishAndRecord(expireRun(current));
        }
      }
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [state, getElapsedMs, finishAndRecord]);

  // Periodic clock persistence + save on tab hide/unload so a refresh
  // mid-run never loses more than a few seconds of clock.
  useEffect(() => {
    if (!state || state.status !== "active") return;

    const save = () => {
      const current = stateRef.current;
      if (current && current.status === "active") {
        persist(current, getElapsedMs());
      }
    };

    const id = window.setInterval(save, CLOCK_SAVE_INTERVAL_MS);
    const onHide = () => save();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [state, getElapsedMs, persist]);

  const startNewRun = useCallback(() => {
    const seed = `${Date.now().toString(36)}-${Math.floor(
      Math.random() * 1_000_000
    ).toString(36)}`;
    const run = createRushRun(seed, Date.now());
    resultSavedRef.current = false;
    baseElapsedRef.current = 0;
    runningSinceRef.current = null;
    setMessage(null);
    setRemainingMs(RUSH_DURATION_MS);
    setSavedRunAvailable(false);
    setState(run);
    saveAutosave(run);
  }, []);

  const resumeSavedRun = useCallback((): boolean => {
    const restored = loadAutosave();
    if (!restored || restored.state.status !== "active") {
      setSavedRunAvailable(false);
      return false;
    }
    const resumed = restored.state;
    resultSavedRef.current = false;
    setMessage(null);
    setSavedRunAvailable(false);

    if (resumed.elapsedMs >= RUSH_DURATION_MS) {
      // Timer already spent; run ends immediately but the result still counts.
      baseElapsedRef.current = RUSH_DURATION_MS;
      runningSinceRef.current = null;
      finishAndRecord(expireRun(resumed));
      return true;
    }

    baseElapsedRef.current = resumed.elapsedMs;
    runningSinceRef.current = resumed.elapsedMs > 0 ? Date.now() : null;
    setRemainingMs(Math.max(0, RUSH_DURATION_MS - resumed.elapsedMs));
    setState(resumed);
    return true;
  }, [finishAndRecord]);

  const discardSavedRun = useCallback(() => {
    clearAutosave();
    setSavedRunAvailable(false);
  }, []);

  const requireActive = useCallback((): RushSnapshot | null => {
    const current = stateRef.current;
    if (!current || current.status !== "active") return null;
    return current;
  }, []);

  const placeRackTile = useCallback(
    (
      rackIndex: number,
      row: number,
      col: number,
      blankLetter: string | null = null
    ): boolean => {
      const current = requireActive();
      if (!current) return false;
      const result = enginePlaceTile(current, rackIndex, row, col, blankLetter);
      if (!result.ok) {
        setMessage({ ...result.error, kind: "error" });
        return false;
      }
      startClockIfNeeded();
      setState(result.state);
      scheduleDraftSave();
      return true;
    },
    [requireActive, scheduleDraftSave, startClockIfNeeded]
  );

  const moveBoardTile = useCallback(
    (fromRow: number, fromCol: number, toRow: number, toCol: number): boolean => {
      const current = requireActive();
      if (!current) return false;
      const result = engineMoveBoardTile(current, fromRow, fromCol, toRow, toCol);
      if (!result.ok) return false;
      setState(result.state);
      scheduleDraftSave();
      return true;
    },
    [requireActive, scheduleDraftSave]
  );

  const removeBoardTile = useCallback(
    (row: number, col: number): boolean => {
      const current = requireActive();
      if (!current) return false;
      const result = engineRemoveBoardTile(current, row, col);
      if (!result.ok) return false;
      setState(result.state);
      scheduleDraftSave();
      return true;
    },
    [requireActive, scheduleDraftSave]
  );

  /** Drag a draft tile from the board back into the rack (with reorder). */
  const returnTileToRack = useCallback(
    (row: number, col: number, visibleIndex: number | null = null): boolean => {
      const current = requireActive();
      if (!current) return false;
      const tile = current.board[row]?.[col];
      const removed = engineRemoveBoardTile(current, row, col);
      if (!removed.ok) return false;
      let next = removed.state;
      if (
        visibleIndex != null &&
        tile &&
        tile.rackIndex !== undefined
      ) {
        next = engineReorderRack(next, tile.rackIndex, visibleIndex, tile.rackIndex);
      }
      setState(next);
      scheduleDraftSave();
      return true;
    },
    [requireActive, scheduleDraftSave]
  );

  const returnAllDrafts = useCallback(() => {
    const current = requireActive();
    if (!current) return;
    setState(returnAllDraftTiles(current));
    scheduleDraftSave();
  }, [requireActive, scheduleDraftSave]);

  const reorderRack = useCallback(
    (fromIndex: number, toIndex: number, releasedIndex: number | null = null) => {
      const current = requireActive();
      if (!current) return;
      setState(engineReorderRack(current, fromIndex, toIndex, releasedIndex));
      scheduleDraftSave();
    },
    [requireActive, scheduleDraftSave]
  );

  const shuffleRack = useCallback(() => {
    const current = requireActive();
    if (!current) return;
    const next = engineShuffleRack(current);
    if (next === current) return;
    setState(next);
    persist(next, getElapsedMs());
  }, [requireActive, persist, getElapsedMs]);

  const submitWord = useCallback((): SubmitDetail | null => {
    const current = requireActive();
    if (!current) return null;
    if (dictionary.loaded === false) {
      setMessage({
        title: "Loading",
        text: "The dictionary is still loading — try again in a second.",
        kind: "error",
      });
      return null;
    }

    const elapsed = getElapsedMs();
    const result = engineSubmitTurn(current, dictionary, elapsed);
    if (!result.ok) {
      setMessage({ ...result.error, kind: "error" });
      return null;
    }

    if (result.state.status === "active") {
      setState(result.state);
      persist(result.state, elapsed);
      const scrabbleBonusMessage =
        result.detail.earnedScrabbleBonus && result.detail.scrabbleBonus > 0
          ? result.detail.scrabbleBonusType === "lite"
            ? `Scrabble Mini bonus +${result.detail.scrabbleBonus}`
            : `Scrabble bonus +${result.detail.scrabbleBonus}`
          : null;
      setMessage({
        title: "Word Accepted!",
        text: result.detail.words.join(", "),
        kind: "success",
        turnPoints: result.detail.turnScore,
        consistencyBonus: result.detail.consistencyBonus,
        scrabbleBonusMessage,
      });
    } else {
      // Played out every tile: the run finished inside submitTurn.
      finishAndRecord(result.state);
    }
    return result.detail;
  }, [requireActive, getElapsedMs, persist, finishAndRecord]);

  const swapTiles = useCallback(
    (rackIndices: number[]): boolean => {
      const current = requireActive();
      if (!current) return false;
      // Swapping is a game action: it starts the run clock like a placement.
      startClockIfNeeded();
      const elapsed = getElapsedMs();
      const result = engineSwapTiles(current, rackIndices, elapsed);
      if (!result.ok) {
        setMessage({ ...result.error, kind: "error" });
        return false;
      }
      setState(result.state);
      persist(result.state, elapsed);
      setMessage({
        title: "Tiles Swapped",
        text: `-${result.detail.penalty} points`,
        kind: "success",
      });
      return true;
    },
    [requireActive, getElapsedMs, persist, startClockIfNeeded]
  );

  const dismissMessage = useCallback(() => setMessage(null), []);

  const usedRackIndices = useMemo(
    () => (state ? getUsedRackIndices(state) : new Set<number>()),
    [state]
  );

  const runningScore = state ? getRunningScore(state) : 0;

  // Expose finishRun for completeness of the public surface (unused for now).
  void finishRun;

  return {
    state,
    remainingMs,
    runningScore,
    usedRackIndices,
    message,
    dictionaryReady,
    savedRunAvailable,
    startNewRun,
    resumeSavedRun,
    discardSavedRun,
    placeRackTile,
    moveBoardTile,
    removeBoardTile,
    returnTileToRack,
    returnAllDrafts,
    reorderRack,
    shuffleRack,
    submitWord,
    swapTiles,
    dismissMessage,
    pauseClock,
    resumeClock,
  };
};
