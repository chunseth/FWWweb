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

const WARNING_THRESHOLDS_MS = [120_000, 30_000, 10_000];

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
}

export const GameHud = memo(
  ({ remainingMs, score, tilesRemaining }: GameHudProps) => {
    const displayScore = useAnimatedNumber(score);
    const [flash, setFlash] = useState(false);
    const prevRemainingRef = useRef(remainingMs);

    // Restrained flash when crossing 2:00, 0:30, 0:10.
    useEffect(() => {
      const prev = prevRemainingRef.current;
      prevRemainingRef.current = remainingMs;
      const crossed = WARNING_THRESHOLDS_MS.some(
        (threshold) => prev > threshold && remainingMs <= threshold
      );
      if (crossed) {
        setFlash(true);
        const id = window.setTimeout(() => setFlash(false), 950);
        return () => window.clearTimeout(id);
      }
    }, [remainingMs]);

    const level =
      remainingMs <= 10_000
        ? "critical"
        : remainingMs <= 30_000
          ? "warn"
          : remainingMs <= 120_000
            ? "notice"
            : null;

    const timerClass = [
      "hud__timer",
      level ? `hud__timer--${level}` : "",
      flash ? "hud__timer--flash" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className="hud">
        <div className="hud__score">
          <span className="hud__label">Score</span>
          <span className="hud__score-value">{displayScore}</span>
        </div>
        <div className={timerClass} role="timer" aria-live="off">
          {formatClock(remainingMs)}
        </div>
        <div className="hud__bag">
          <span className="hud__label">Bag</span>
          <span className="hud__bag-value">{tilesRemaining}</span>
        </div>
      </div>
    );
  }
);

GameHud.displayName = "GameHud";
