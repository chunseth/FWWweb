import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameHud } from "./components/GameHud";
import { MiniBoard } from "./components/MiniBoard";
import { TileRack } from "./components/TileRack";
import type { RackPreview, SwapFloat } from "./components/TileRack";
import { BlankLetterPicker } from "./components/BlankLetterPicker";
import { GameOverPanel } from "./components/GameOverPanel";
import { PauseMenu } from "./components/PauseMenu";
import { ComboExplainerModal } from "./components/ComboExplainerModal";
import { UsernameForm } from "./components/UsernameForm";
import { BoardViewport } from "./components/BoardViewport";
import { useRushGame } from "./game/rush/useRushGame";
import { useTileDrag } from "./game/rush/useTileDrag";
import type { DragSource } from "./game/rush/useTileDrag";
import { getBestLocalResult } from "./game/rush/localResults";
import { loadProfile } from "./services/usernameService";
import type { StoredProfile } from "./services/usernameService";
import { LeaderboardPage } from "./components/LeaderboardPage";
import { isBackendConfigured } from "./services/supabaseClient";
import { BLANK_LETTER } from "./game/shared/bag";
import { MINI_BOARD_SIZE } from "./game/shared/premiumSquares";
import { getPlacedCells, validateSubmitTurn } from "./game/shared/validation";
import { scoreSubmittedWords } from "./game/shared/scoring";
import { dictionary } from "./utils/dictionary";

const TOAST_MS = 2400;
const COMBO_EXPLAINED_KEY = "fwwweb.comboExplained.v1";
const SWAP_TILE_STAGGER_MS = 380;
const SWAP_COMMIT_EXTRA_MS = 450;
const MUSIC_URL = "/friendswwords.mp3";
const DEFAULT_MUSIC_VOLUME = 0.55;

const isJsdom = () =>
  typeof navigator !== "undefined" &&
  navigator.userAgent.toLowerCase().includes("jsdom");

interface PendingBlank {
  rackIndex: number;
  row: number;
  col: number;
}

const comboExplained = (): boolean => {
  try {
    return localStorage.getItem(COMBO_EXPLAINED_KEY) === "1";
  } catch {
    return true;
  }
};

const markComboExplained = () => {
  try {
    localStorage.setItem(COMBO_EXPLAINED_KEY, "1");
  } catch {
    /* ignore */
  }
};

export const App = () => {
  const game = useRushGame();
  const {
    state,
    remainingMs,
    runningScore,
    usedRackIndices,
    message,
    dictionaryReady,
    savedRunAvailable,
    starting,
    syncState,
  } = game;

  const [profile, setProfile] = useState<StoredProfile | null>(() =>
    loadProfile()
  );
  const [editingName, setEditingName] = useState(false);
  const [showComboModal, setShowComboModal] = useState(false);
  const [paused, setPaused] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(DEFAULT_MUSIC_VOLUME);
  const [swapMode, setSwapMode] = useState(false);
  const [swapSelection, setSwapSelection] = useState<Set<number>>(new Set());
  const [swapFloats, setSwapFloats] = useState<SwapFloat[]>([]);
  const [rackPreview, setRackPreview] = useState<RackPreview | null>(null);
  const swapAnimatingRef = useRef(false);
  const swapTimeoutsRef = useRef<number[]>([]);
  const [pendingBlank, setPendingBlank] = useState<PendingBlank | null>(null);
  // Hash-routed leaderboard page (#/leaderboard) so the browser back button
  // returns to the game/menu naturally.
  const [showLeaderboard, setShowLeaderboard] = useState(
    () =>
      typeof window !== "undefined" &&
      window.location.hash === "#/leaderboard"
  );

  useEffect(() => {
    const onHashChange = () => {
      setShowLeaderboard(window.location.hash === "#/leaderboard");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const openLeaderboard = useCallback(() => {
    window.location.hash = "#/leaderboard";
  }, []);

  const closeLeaderboard = useCallback(() => {
    if (window.location.hash === "#/leaderboard") {
      window.history.back();
    } else {
      setShowLeaderboard(false);
    }
  }, []);

  // Freeze the run clock while the leaderboard page covers an active game;
  // resume on return unless the player had paused deliberately.
  useEffect(() => {
    if (!state || state.status !== "active") return;
    if (showLeaderboard) {
      game.pauseClock();
    } else if (!paused) {
      game.resumeClock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLeaderboard]);

  const musicRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicBufferRef = useRef<AudioBuffer | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const musicSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const musicLoadingRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const musicShouldPlayRef = useRef(false);
  const boardWrapRef = useRef<HTMLDivElement>(null);

  // ResizeObserver keeps --cell-size (px) in sync with the board width so
  // tiles and type scale together without viewport-based font sizes.
  useEffect(() => {
    const el = boardWrapRef.current;
    if (!el) return;
    const apply = (width: number) => {
      document.documentElement.style.setProperty(
        "--cell-size",
        `${width / MINI_BOARD_SIZE}px`
      );
    };
    apply(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        apply(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [state != null]);

  // Toast auto-dismiss.
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(game.dismissMessage, TOAST_MS);
    return () => window.clearTimeout(id);
  }, [message, game.dismissMessage]);

  // Clear any swap choreography timers on unmount.
  useEffect(
    () => () => {
      swapTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    },
    []
  );

  const isActive = state?.status === "active";

  useEffect(() => {
    if (state?.status === "expired") {
      pauseMusic();
    }
  }, [state?.status]);

  useEffect(() => {
    if (musicRef.current) {
      musicRef.current.volume = musicVolume;
    }
    if (musicGainRef.current) {
      musicGainRef.current.gain.value = musicVolume;
    }
  }, [musicVolume]);

  useEffect(
    () => () => {
      pauseMusic();
      audioContextRef.current?.close().catch(() => {
        /* ignore */
      });
    },
    []
  );

  const canDropOnCell = useCallback(
    (row: number, col: number): boolean =>
      Boolean(
        state &&
          state.status === "active" &&
          state.board[row] &&
          state.board[row][col] === null
      ),
    [state]
  );

  const onDropOnBoard = useCallback(
    (source: DragSource, row: number, col: number): boolean => {
      setRackPreview(null);
      if (!state || state.status !== "active") return false;
      if (source.type === "board") {
        return game.moveBoardTile(source.row, source.col, row, col);
      }
      const tile = state.rack[source.rackIndex];
      if (!tile) return false;
      const isBlank =
        tile.value === 0 &&
        (tile.letter === BLANK_LETTER || tile.letter === "");
      if (isBlank) {
        setPendingBlank({ rackIndex: source.rackIndex, row, col });
        return true;
      }
      return game.placeRackTile(source.rackIndex, row, col);
    },
    [state, game]
  );

  const onDropOnRack = useCallback(
    (source: DragSource, visibleIndex: number): boolean => {
      setRackPreview(null);
      if (source.type === "board") {
        return game.returnTileToRack(source.row, source.col, visibleIndex);
      }
      game.reorderRack(source.rackIndex, visibleIndex);
      return true;
    },
    [game]
  );

  const onTap = useCallback(
    (source: DragSource) => {
      if (source.type === "board") {
        game.removeBoardTile(source.row, source.col);
      }
    },
    [game]
  );

  const drag = useTileDrag({
    canDropOnCell,
    onDropOnBoard,
    onDropOnRack,
    onRackPreview: setRackPreview,
    onTap,
  });

  const placedCount = useMemo(
    () => (state ? getPlacedCells(state.board, state.boardSize).length : 0),
    [state]
  );

  /** Live playability + points preview for the current draft placements. */
  const preview = useMemo(() => {
    if (!state || state.status !== "active" || placedCount === 0) return null;
    if (!dictionaryReady) return null;
    const validation = validateSubmitTurn({
      board: state.board,
      isFirstTurn: state.isFirstTurn,
      boardAtTurnStart: state.boardAtTurnStart,
      dictionary,
      boardSize: state.boardSize,
    });
    if (!validation.ok) {
      return { valid: false as const, reason: validation.error.text };
    }
    const scoring = scoreSubmittedWords({
      board: state.board,
      newWords: validation.newWords,
      premiumSquares: state.premiumSquares,
      turnCount: state.turnCount,
      placedCells: validation.placedCells,
      bonusMode: "mini",
    });
    return {
      valid: true as const,
      points: scoring.turnScore,
      words: validation.newWords.map((w) => w.word.toUpperCase()),
    };
  }, [state, placedCount, dictionaryReady]);

  const best = useMemo(
    () => getBestLocalResult(),
    // Recompute whenever a run ends.
    [state?.status]
  );
  const playUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? "https://friendswithwords.app"
        : window.location.origin,
    []
  );

  // ---------- pause ----------

  const openPause = () => {
    game.pauseClock();
    pauseMusic();
    setPaused(true);
  };

  const closePause = () => {
    setPaused(false);
    playMusic();
    game.resumeClock();
  };

  const newGameFromPause = () => {
    setPaused(false);
    cancelSwap();
    setPendingBlank(null);
    playMusic();
    game.startNewRun();
  };

  // ---------- swap ----------

  const startSwap = () => {
    game.returnAllDrafts();
    setSwapSelection(new Set());
    setSwapMode(true);
  };

  const cancelSwap = () => {
    if (swapAnimatingRef.current) return; // let the animation finish
    setSwapMode(false);
    setSwapSelection(new Set());
    setSwapFloats([]);
  };

  const toggleSwapSelection = (rackIndex: number) => {
    if (swapAnimatingRef.current) return;
    setSwapSelection((prev) => {
      const next = new Set(prev);
      if (next.has(rackIndex)) {
        next.delete(rackIndex);
      } else if (state && next.size < Math.min(7, state.bag.length)) {
        next.add(rackIndex);
      }
      return next;
    });
  };

  /**
   * Sequential swap choreography, matching the mobile app: tiles leave one at
   * a time (the rack does NOT compact between them), each showing its penalty
   * "M.0 × -V" floating up, then the engine commits the whole swap at once.
   */
  const confirmSwap = () => {
    if (!state || swapSelection.size === 0 || swapAnimatingRef.current) return;
    const indices = [...swapSelection].sort((a, b) => a - b);
    const multiplier = state.swapCount + 1;
    swapAnimatingRef.current = true;

    indices.forEach((rackIndex, i) => {
      const id = window.setTimeout(() => {
        const tile = state.rack[rackIndex];
        setSwapFloats((prev) => [
          ...prev,
          {
            rackIndex,
            label: `${multiplier}.0 × −${tile?.value ?? 0}`,
          },
        ]);
      }, i * SWAP_TILE_STAGGER_MS);
      swapTimeoutsRef.current.push(id);
    });

    const commitId = window.setTimeout(
      () => {
        swapAnimatingRef.current = false;
        setSwapFloats([]);
        setSwapMode(false);
        setSwapSelection(new Set());
        game.swapTiles(indices);
      },
      indices.length * SWAP_TILE_STAGGER_MS + SWAP_COMMIT_EXTRA_MS
    );
    swapTimeoutsRef.current.push(commitId);
  };

  const swapPenaltyMultiplier = state ? state.swapCount + 1 : 1;
  const swapPenaltyPreview = state
    ? [...swapSelection].reduce(
        (sum, index) => sum + (state.rack[index]?.value ?? 0),
        0
      ) * swapPenaltyMultiplier
    : 0;

  // ---------- start / menu ----------

  const requestStart = () => {
    playMusic();
    if (!comboExplained()) {
      setShowComboModal(true);
      return;
    }
    game.startNewRun();
  };

  const startFromComboModal = () => {
    markComboExplained();
    setShowComboModal(false);
    playMusic();
    game.startNewRun();
  };

  const handlePlayAgain = () => {
    cancelSwap();
    setPendingBlank(null);
    playMusic();
    game.startNewRun();
  };

  const resumeSavedRun = () => {
    playMusic();
    game.resumeSavedRun();
  };

  const handleMusicEnabledChange = (enabled: boolean) => {
    setMusicEnabled(enabled);
    if (!enabled) {
      pauseMusic();
    }
  };

  const handleMusicVolumeChange = (volume: number) => {
    const nextVolume = Math.max(0, Math.min(1, volume));
    setMusicVolume(nextVolume);
  };

  const loadMusicBuffer = async (
    context: AudioContext
  ): Promise<AudioBuffer | null> => {
    if (musicBufferRef.current) return musicBufferRef.current;
    if (!musicLoadingRef.current) {
      musicLoadingRef.current = fetch(MUSIC_URL)
        .then((response) => response.arrayBuffer())
        .then((data) => context.decodeAudioData(data))
        .then((buffer) => {
          musicBufferRef.current = buffer;
          return buffer;
        })
        .catch(() => null);
    }
    return musicLoadingRef.current;
  };

  const playWebAudioMusic = async (): Promise<boolean> => {
    if (
      isJsdom() ||
      typeof AudioContext === "undefined" ||
      typeof fetch === "undefined"
    ) {
      return false;
    }

    try {
      const context =
        audioContextRef.current ?? new AudioContext({ latencyHint: "playback" });
      audioContextRef.current = context;
      if (context.state === "suspended") {
        await context.resume();
      }

      const buffer = await loadMusicBuffer(context);
      if (!buffer || !musicShouldPlayRef.current || !musicEnabled) return false;

      if (!musicGainRef.current) {
        const gain = context.createGain();
        gain.connect(context.destination);
        musicGainRef.current = gain;
      }
      musicGainRef.current.gain.value = musicVolume;

      if (!musicSourceRef.current) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.connect(musicGainRef.current);
        source.start();
        musicSourceRef.current = source;
      }
      return true;
    } catch {
      return false;
    }
  };

  const playMusic = () => {
    if (!musicEnabled) return;
    const music = musicRef.current;
    if (!music || isJsdom()) return;

    musicShouldPlayRef.current = true;
    playWebAudioMusic().then((usingWebAudio) => {
      if (usingWebAudio || !musicShouldPlayRef.current || !musicEnabled) return;

      music.loop = true;
      music.volume = musicVolume;
      try {
        const result = music.play();
        if (result && "catch" in result) {
          result.catch(() => {
            /* Browser may block audio until a direct user gesture. */
          });
        }
      } catch {
        /* jsdom and some browsers can reject media playback synchronously. */
      }
    });
  };

  const pauseMusic = () => {
    musicShouldPlayRef.current = false;
    if (musicSourceRef.current) {
      try {
        musicSourceRef.current.stop();
        musicSourceRef.current.disconnect();
      } catch {
        /* source may already be stopped */
      }
      musicSourceRef.current = null;
    }

    if (isJsdom()) return;

    try {
      musicRef.current?.pause();
    } catch {
      /* Ignore media API failures in constrained environments. */
    }
  };

  // ---------- leaderboard page ----------

  if (showLeaderboard) {
    return <LeaderboardPage onBack={closeLeaderboard} />;
  }

  // ---------- menu screens ----------

  if (!state) {
    return (
      <>
        <audio ref={musicRef} src={MUSIC_URL} loop preload="auto" />
        <div className="screen screen--menu">
          <div className="menu__brand">
            <img
              className="menu__icon"
              src="/1024.png"
              alt=""
              width="1024"
              height="1024"
            />
            <h1 className="menu__title">Friends With Words</h1>
          </div>
          <p className="menu__subtitle">5-Minute Rush · 11×11 board</p>
          {best ? (
            <p className="menu__best">Best score: {best.breakdown.finalScore}</p>
          ) : null}

          {!profile || editingName ? (
            <UsernameForm
              initialValue={profile?.username ?? ""}
              onSaved={(saved) => {
                setProfile(saved);
                setEditingName(false);
              }}
            />
          ) : (
            <p className="menu__player">
              Playing as <strong>{profile.username}</strong>
              {profile.verified ? "" : " (device-only)"}
              <button
                className="menu__change-name"
                onClick={() => setEditingName(true)}
              >
                change
              </button>
            </p>
          )}

          {savedRunAvailable ? (
            <>
              <button
                className="btn btn--primary"
                onClick={resumeSavedRun}
                disabled={!profile}
              >
                Resume Run
              </button>
              <button className="btn btn--danger" onClick={game.discardSavedRun}>
                Discard Saved Run
              </button>
            </>
          ) : (
            <button
              className="btn btn--primary"
              onClick={requestStart}
              disabled={!dictionaryReady || !profile || editingName || starting}
            >
              {!dictionaryReady
                ? "Loading words…"
                : starting
                  ? "Starting…"
                  : "Start Rush"}
            </button>
          )}

          {isBackendConfigured() ? (
            <button className="btn btn--ghost" onClick={openLeaderboard}>
              Leaderboard
            </button>
          ) : null}

          {showComboModal ? (
            <ComboExplainerModal onStart={startFromComboModal} />
          ) : null}

          <div className="rotate-overlay">
            <p>Rotate your phone — Rush plays in portrait.</p>
          </div>
        </div>
      </>
    );
  }

  // ---------- game screen ----------

  return (
    <>
      <audio ref={musicRef} src={MUSIC_URL} loop preload="auto" />
      <div className="screen">
        <GameHud
          remainingMs={remainingMs}
          score={runningScore}
          tilesRemaining={state.bag.length}
          comboStreak={state.consistencyStreak}
          onMenu={openPause}
        />

      <BoardViewport
        wrapRef={boardWrapRef}
        overlay={
          message?.kind === "success" ? (
            <div className="board-turn-banner" onClick={game.dismissMessage}>
              <p className="board-turn-banner__title">
                {message.title}
                {message.turnPoints != null ? (
                  <span className="board-turn-banner__points">
                    {" "}
                    +{message.turnPoints}
                  </span>
                ) : null}
                {message.consistencyBonus ? (
                  <span className="board-turn-banner__combo">
                    {" "}
                    🔥 COMBO +{message.consistencyBonus}
                  </span>
                ) : null}
              </p>
              <p className="board-turn-banner__text">
                {message.text}
                {message.scrabbleBonusMessage
                  ? ` · ${message.scrabbleBonusMessage}`
                  : ""}
              </p>
            </div>
          ) : null
        }
      >
        <MiniBoard
          board={state.board}
          premiumSquares={state.premiumSquares}
          boardRef={drag.boardRef}
          onTilePointerDown={drag.startDrag}
          interactive={isActive && !swapMode && !paused}
        />
      </BoardViewport>

      <div className="rack-area">
        {/* Fixed-height slot: the chip appearing never shifts the layout. */}
        <div className="score-preview" aria-live="polite">
          {preview ? (
            preview.valid ? (
              <span className="score-preview__chip score-preview__chip--ok">
                ✓ {preview.words.join(", ")} · +{preview.points}
              </span>
            ) : (
              <span className="score-preview__chip score-preview__chip--bad">
                ✗ {preview.reason}
              </span>
            )
          ) : null}
        </div>

        <div className={paused ? "rack-blur" : undefined}>
          <TileRack
            rack={state.rack}
            usedRackIndices={usedRackIndices}
            rackRef={drag.rackRef}
            onTilePointerDown={drag.startDrag}
            interactive={isActive && !paused}
            swapMode={swapMode}
            selectedIndices={swapSelection}
            onToggleSelect={toggleSwapSelection}
            swapFloats={swapFloats}
            rackPreview={rackPreview}
          />
        </div>

        {swapMode ? (
          <>
            <p className="swap-hint">
              {swapSelection.size > 0
                ? `Penalty: −${swapPenaltyPreview} pts (${swapPenaltyMultiplier}.0 × letter value)`
                : `Select tiles to swap · multiplier ×${swapPenaltyMultiplier}`}
            </p>
            <div className="controls">
              <button
                className="btn btn--ghost"
                onClick={cancelSwap}
                disabled={swapFloats.length > 0}
              >
                Cancel
              </button>
              <button
                className="btn btn--primary"
                onClick={confirmSwap}
                disabled={swapSelection.size === 0 || swapFloats.length > 0}
              >
                Swap {swapSelection.size || ""}
              </button>
            </div>
          </>
        ) : (
          <div className="controls">
            <button
              className="btn"
              onClick={startSwap}
              disabled={!isActive || paused || state.bag.length === 0}
            >
              Swap
            </button>
            <button
              className="btn btn--primary"
              onClick={game.submitWord}
              disabled={!isActive || paused || placedCount === 0 || !dictionaryReady}
            >
              {preview?.valid ? `Submit +${preview.points}` : "Submit"}
            </button>
            {placedCount > 0 ? (
              <button
                className="btn"
                onClick={game.returnAllDrafts}
                disabled={!isActive || paused}
              >
                Recall
              </button>
            ) : (
              <button
                className="btn"
                onClick={game.shuffleRack}
                disabled={!isActive || paused || state.rack.length < 2}
              >
                Shuffle
              </button>
            )}
          </div>
        )}
      </div>

      {message && message.kind === "error" ? (
        <div
          className={`toast${message.kind === "error" ? " toast--error" : ""}`}
          onClick={game.dismissMessage}
        >
          <p className="toast__title">
            {message.title}
            {message.turnPoints != null ? (
              <span className="toast__points"> +{message.turnPoints}</span>
            ) : null}
            {message.consistencyBonus ? (
              <span className="toast__combo">
                🔥 COMBO +{message.consistencyBonus}
              </span>
            ) : null}
          </p>
          <p className="toast__text">
            {message.text}
            {message.scrabbleBonusMessage
              ? ` · ${message.scrabbleBonusMessage}`
              : ""}
          </p>
        </div>
      ) : null}

      {pendingBlank ? (
        <BlankLetterPicker
          onPick={(letter) => {
            game.placeRackTile(
              pendingBlank.rackIndex,
              pendingBlank.row,
              pendingBlank.col,
              letter
            );
            setPendingBlank(null);
          }}
          onCancel={() => setPendingBlank(null)}
        />
      ) : null}

      {paused && isActive ? (
        <PauseMenu
          onResume={closePause}
          onNewGame={newGameFromPause}
          onShowLeaderboard={isBackendConfigured() ? openLeaderboard : null}
          musicEnabled={musicEnabled}
          musicVolume={musicVolume}
          onMusicEnabledChange={handleMusicEnabledChange}
          onMusicVolumeChange={handleMusicVolumeChange}
        />
      ) : null}

      {state.status === "expired" && state.finalBreakdown ? (
        <GameOverPanel
          breakdown={state.finalBreakdown}
          wordCount={state.wordCount}
          best={best}
          syncState={syncState}
          board={state.board}
          premiumSquares={state.premiumSquares}
          playUrl={playUrl}
          rank={game.submittedRank}
          onShowLeaderboard={isBackendConfigured() ? openLeaderboard : null}
          onPlayAgain={handlePlayAgain}
        />
      ) : null}

      <div className="rotate-overlay">
        <p>Rotate your phone — Rush plays in portrait.</p>
      </div>
      </div>
    </>
  );
};
