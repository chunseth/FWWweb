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
  getRushDurationMs,
  getUsedRackIndices,
  moveBoardTile as engineMoveBoardTile,
  placeTile as enginePlaceTile,
  removeBoardTile as engineRemoveBoardTile,
  reorderRack as engineReorderRack,
  returnAllDraftTiles,
  shuffleRack as engineShuffleRack,
  submitTurn as engineSubmitTurn,
  swapTiles as engineSwapTiles,
} from "./rushEngine";
import type { RushRunConfig, SubmitDetail } from "./rushEngine";
import {
  createRushRunOnServer,
  submitRushRunToServer,
} from "../../services/rushRunService";
import {
  enqueueSubmission,
  processPendingSubmissions,
} from "../../services/pendingSubmissions";
import { isBackendConfigured } from "../../services/supabaseClient";
import { loadProfile } from "../../services/usernameService";
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

/**
 * Where a finished run's score stands with the public leaderboard.
 * - local_only: run never had a server id (offline/unconfigured start)
 * - submitting/submitted/rejected: live submission flow
 * - queued: ended offline; will retry within the grace window
 */
export type RushSyncState =
  | "idle"
  | "local_only"
  | "submitting"
  | "submitted"
  | "queued"
  | "rejected";

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
  /** True while a server run is being created (Start button spinner). */
  starting: boolean;
  /** Leaderboard submission state for the finished run. */
  syncState: RushSyncState;
  /** Global rank of the player's personal best, once the server confirms it. */
  submittedRank: number | null;
  startNewRun: (config?: Partial<RushRunConfig>) => Promise<void>;
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
  const [remainingMs, setRemainingMs] = useState(300_000);
  const [message, setMessage] = useState<GameMessage | null>(null);
  const [dictionaryReady, setDictionaryReady] = useState(
    dictionary.loaded ?? true
  );
  const [savedRunAvailable, setSavedRunAvailable] = useState(false);
  const [starting, setStarting] = useState(false);
  const [syncState, setSyncState] = useState<RushSyncState>("idle");
  const [submittedRank, setSubmittedRank] = useState<number | null>(null);

  const stateRef = useRef<RushSnapshot | null>(null);
  stateRef.current = state;

  /** Elapsed active ms at the moment the in-memory clock last (re)started. */
  const baseElapsedRef = useRef(0);
  /** Wall-clock ms when the in-memory clock last (re)started; null if stopped. */
  const runningSinceRef = useRef<number | null>(null);
  const resultSavedRef = useRef(false);
  const draftSaveTimerRef = useRef<number | null>(null);

  const getCurrentDurationMs = useCallback((): number => {
    const current = stateRef.current;
    return current ? getRushDurationMs(current) : 300_000;
  }, []);

  const getElapsedMs = useCallback((): number => {
    const base = baseElapsedRef.current;
    const since = runningSinceRef.current;
    const elapsed = since == null ? base : base + (Date.now() - since);
    return Math.min(elapsed, getCurrentDurationMs());
  }, [getCurrentDurationMs]);

  const startClockIfNeeded = useCallback(() => {
    if (runningSinceRef.current != null) return;
    runningSinceRef.current = Date.now();
  }, []);

  /** Freeze the countdown (pause menu). No-op if the clock never started. */
  const pauseClock = useCallback((): boolean => {
    if (runningSinceRef.current == null) return false;
    const current = stateRef.current;
    baseElapsedRef.current = Math.min(
      baseElapsedRef.current + (Date.now() - runningSinceRef.current),
      getRushDurationMs(current ?? { durationSeconds: 300 })
    );
    runningSinceRef.current = null;
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

  /** Push a finished eligible run through the hardened server path. */
  const submitFinishedRun = useCallback((finished: RushSnapshot) => {
    if (!finished.runId || finished.eligibility === "local_only") {
      setSyncState("local_only");
      return;
    }
    const durationMs = getRushDurationMs(finished);
    const deadlineAtMs = finished.startedAtWallMs + durationMs + 60_000;
    if (Date.now() > deadlineAtMs) {
      setSyncState("local_only");
      return;
    }

    const displayName = loadProfile()?.username;
    setSyncState("submitting");
    void submitRushRunToServer(finished.runId, finished.journal, displayName)
      .then((outcome) => {
        if (outcome.status === "accepted") {
          setSubmittedRank(outcome.rank);
          setSyncState("submitted");
        } else if (outcome.status === "rejected") {
          setSyncState("rejected");
        } else {
          enqueueSubmission({
            runId: finished.runId!,
            seed: finished.seed,
            journal: finished.journal,
            displayName,
            deadlineAtMs,
            queuedAtMs: Date.now(),
          });
          setSyncState("queued");
        }
      })
      .catch(() => setSyncState("queued"));
  }, []);

  const finishAndRecord = useCallback(
    (finished: RushSnapshot) => {
      setState(finished);
      runningSinceRef.current = null;
      baseElapsedRef.current = finished.elapsedMs;
      setRemainingMs(Math.max(0, getRushDurationMs(finished) - finished.elapsedMs));
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
        submitFinishedRun(finished);
      }
    },
    [submitFinishedRun]
  );

  // Flush any queued offline submissions on load and on reconnect.
  useEffect(() => {
    if (!isBackendConfigured()) return;
    const flush = () => void processPendingSubmissions().catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);

  // Countdown tick + expiry.
  useEffect(() => {
    if (!state || state.status !== "active") return;

    const tick = () => {
      const elapsed = getElapsedMs();
      const remaining = Math.max(0, getRushDurationMs(state) - elapsed);
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

  const mountRun = useCallback((run: RushSnapshot) => {
    resultSavedRef.current = false;
    baseElapsedRef.current = 0;
    runningSinceRef.current = null;
    setMessage(null);
    setSyncState("idle");
    setSubmittedRank(null);
    setRemainingMs(getRushDurationMs(run));
    setSavedRunAvailable(false);
    setState(run);
    saveAutosave(run);
  }, []);

  /**
   * Start a run. When the backend is configured, ask the server for a seed
   * and run id first (leaderboard eligibility requires starting online); on
   * timeout/offline fall back to a local seed marked local_only. When no
   * backend is configured, this resolves synchronously.
   */
  const startNewRun = useCallback(async (
    config?: Partial<RushRunConfig>
  ): Promise<void> => {
    const startLocal = () => {
      const seed = `${Date.now().toString(36)}-${Math.floor(
        Math.random() * 1_000_000
      ).toString(36)}`;
      mountRun(createRushRun(seed, Date.now(), config));
    };

    if (!isBackendConfigured()) {
      startLocal();
      return;
    }

    setStarting(true);
    try {
      const server = await createRushRunOnServer(config);
      if (server) {
        const run = createRushRun(server.seed, server.startedAtMs, {
          durationSeconds: server.durationSeconds === 600 ? 600 : 300,
        });
        run.runId = server.runId;
        run.eligibility = "eligible";
        mountRun(run);
      } else {
        startLocal();
      }
    } catch {
      startLocal();
    } finally {
      setStarting(false);
    }
  }, [mountRun]);

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

    const durationMs = getRushDurationMs(resumed);
    if (resumed.elapsedMs >= durationMs) {
      // Timer already spent; run ends immediately but the result still counts.
      baseElapsedRef.current = durationMs;
      runningSinceRef.current = null;
      finishAndRecord(expireRun(resumed));
      return true;
    }

    baseElapsedRef.current = resumed.elapsedMs;
    runningSinceRef.current = resumed.elapsedMs > 0 ? Date.now() : null;
    setRemainingMs(Math.max(0, durationMs - resumed.elapsedMs));
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
    starting,
    syncState,
    submittedRank,
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
