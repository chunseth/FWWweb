import { memo, useEffect, useRef, useState } from "react";

/** Fast, readable score count-up driven by rAF (never re-renders per frame
 * beyond the number itself; board/rack geometry is unaffected). */
const useAnimatedNumber = (value: number, durationMs = 380): number => {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = value;
    };
  }, [value, durationMs]);

  return display;
};

/** Threshold banners: fixed overlay, pointer-events none, zero layout shift,
 * so an in-flight drag is never interrupted. */
const BANNERS: Array<{ thresholdMs: number; text: string; showMs: number }> = [
  { thresholdMs: 120_000, text: "2 minutes remaining", showMs: 2000 },
  { thresholdMs: 30_000, text: "30 seconds!", showMs: 2000 },
  { thresholdMs: 10_000, text: "10 seconds!", showMs: 400 },
];

const formatClock = (ms: number): string => {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

interface GameHudProps {
  remainingMs: number;
  score: number;
  tilesRemaining: number;
  comboStreak: number;
  onMenu: () => void;
}

export const GameHud = memo(
  ({ remainingMs, score, tilesRemaining, comboStreak, onMenu }: GameHudProps) => {
    const displayScore = useAnimatedNumber(score);
    const [banner, setBanner] = useState<string | null>(null);
    const prevRemainingRef = useRef(remainingMs);
    const bannerTimeoutRef = useRef<number | null>(null);

    useEffect(() => {
      const prev = prevRemainingRef.current;
      prevRemainingRef.current = remainingMs;
      if (remainingMs > prev) {
        if (bannerTimeoutRef.current != null) {
          window.clearTimeout(bannerTimeoutRef.current);
          bannerTimeoutRef.current = null;
        }
        setBanner(null);
        return;
      }
      const crossed = BANNERS.find(
        ({ thresholdMs }) => prev > thresholdMs && remainingMs <= thresholdMs
      );
      if (crossed) {
        if (bannerTimeoutRef.current != null) {
          window.clearTimeout(bannerTimeoutRef.current);
        }
        setBanner(crossed.text);
        bannerTimeoutRef.current = window.setTimeout(() => {
          bannerTimeoutRef.current = null;
          setBanner(null);
        }, crossed.showMs);
      }
    }, [remainingMs]);

    useEffect(
      () => () => {
        if (bannerTimeoutRef.current != null) {
          window.clearTimeout(bannerTimeoutRef.current);
        }
      },
      []
    );

    const level =
      remainingMs <= 10_000
        ? "critical"
        : remainingMs <= 30_000
          ? "warn"
          : remainingMs <= 120_000
            ? "notice"
            : null;

    const timerClass = ["hud__timer", level ? `hud__timer--${level}` : ""]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="hud">
        <div className="hud__score">
          <span className="hud__label">Score</span>
          <span className="hud__score-row">
            <span className="hud__score-value">{displayScore}</span>
            {comboStreak >= 2 ? (
              <span
                className={`hud__combo${
                  comboStreak >= 3 ? " hud__combo--hot" : ""
                }`}
                title="Combo streak: 20+ point turns in a row"
              >
                🔥×{comboStreak}
              </span>
            ) : null}
          </span>
        </div>
        <div className={timerClass} role="timer" aria-live="off">
          {formatClock(remainingMs)}
        </div>
        <div className="hud__right">
          <div className="hud__bag">
            <span className="hud__label">Bag</span>
            <span className="hud__bag-value">{tilesRemaining}</span>
          </div>
          <button
            className="hud__menu-btn"
            onClick={onMenu}
            aria-label="Menu (pause)"
          >
            ☰
          </button>
        </div>

        {banner ? <div className="time-banner">{banner}</div> : null}
      </div>
    );
  }
);

GameHud.displayName = "GameHud";
