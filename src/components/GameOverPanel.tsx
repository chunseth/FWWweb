import { useEffect, useMemo, useState } from "react";
import type { RushScoreBreakdown } from "../game/shared/types";
import type { MiniBoard, PremiumSquares, PremiumSquareType } from "../game/shared/types";
import type { LocalRushResult } from "../game/rush/localResults";
import type { RushSyncState } from "../game/rush/useRushGame";

interface GameOverPanelProps {
  breakdown: RushScoreBreakdown;
  wordCount: number;
  best: LocalRushResult | null;
  syncState: RushSyncState;
  board: MiniBoard;
  premiumSquares: PremiumSquares;
  playUrl: string;
  /** Global rank of the player's personal best (server-confirmed). */
  rank: number | null;
  /** Server rejection reason, shown with the "couldn't verify" sync line. */
  syncDetail?: string | null;
  /** Navigate to the leaderboard page; null hides the button. */
  onShowLeaderboard: (() => void) | null;
  onPlayAgain: () => void;
  onMainMenu: () => void;
}

/** Subtle, non-blocking leaderboard sync status. */
const SYNC_TEXT: Record<RushSyncState, string> = {
  idle: "Saved on this device.",
  local_only: "Saved on this device — offline runs stay local.",
  submitting: "Saved on this device. Submitting to the leaderboard…",
  submitted: "On the leaderboard ✓",
  queued: "Saved on this device. Offline — will submit when you're back online.",
  rejected: "Saved on this device. Score couldn't be verified for the leaderboard.",
};

const SHARE_SIZE = 1200;
const BOARD_PX = 792;

/** Human-readable mode, derived from the board itself. */
const getModeLabel = (board: MiniBoard): string =>
  board.length === 15
    ? "10-Minute Classic Rush · 15×15"
    : "5-Minute Mini Rush · 11×11";
const PREMIUM_COLORS: Record<PremiumSquareType, string> = {
  tw: "#c94f4f",
  dw: "#d98243",
  tl: "#4f79c9",
  dl: "#3fa3a0",
  center: "#b89230",
};
const PREMIUM_LABELS: Record<PremiumSquareType, string> = {
  tw: "TW",
  dw: "DW",
  tl: "TL",
  dl: "DL",
  center: "*",
};

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
};

const buildShareImage = ({
  board,
  premiumSquares,
  score,
  wordCount,
  playUrl,
}: {
  board: MiniBoard;
  premiumSquares: PremiumSquares;
  score: number;
  wordCount: number;
  playUrl: string;
}): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = SHARE_SIZE;
    canvas.height = SHARE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas unavailable"));
      return;
    }

    // The board itself tells us the mode: 11x11 mini or 15x15 classic.
    // Every tile metric scales from the cell size so the FULL board renders
    // for both modes.
    const cells = Math.max(board.length, 1);
    const cell = BOARD_PX / cells;
    const modeLabel = getModeLabel(board);

    ctx.fillStyle = "#16202b";
    ctx.fillRect(0, 0, SHARE_SIZE, SHARE_SIZE);

    ctx.fillStyle = "#eef3f8";
    ctx.font = "800 62px Avenir Next, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Friends With Words", SHARE_SIZE / 2, 94);

    ctx.fillStyle = "#ffb74d";
    ctx.font = "800 48px Avenir Next, Segoe UI, sans-serif";
    ctx.fillText(`${score.toLocaleString()} points`, SHARE_SIZE / 2, 154);

    ctx.fillStyle = "#93a5b8";
    ctx.font = "700 26px Avenir Next, Segoe UI, sans-serif";
    ctx.fillText(`${wordCount} words in ${modeLabel}`, SHARE_SIZE / 2, 198);

    const boardX = (SHARE_SIZE - BOARD_PX) / 2;
    const boardY = 244;
    drawRoundRect(ctx, boardX - 12, boardY - 12, BOARD_PX + 24, BOARD_PX + 24, 28);
    ctx.fillStyle = "#1d2733";
    ctx.fill();

    // Cell-relative metrics (tuned to match the old 11x11 look: cell=72px).
    const tileInset = cell * 0.1;
    const tileRadius = cell * 0.125;
    const letterFont = Math.round(cell * 0.47);
    const letterBaseline = cell * 0.62;
    const valueFont = Math.max(9, Math.round(cell * 0.21));
    const premiumFont = Math.max(10, Math.round(cell * 0.25));

    for (let row = 0; row < cells; row += 1) {
      for (let col = 0; col < cells; col += 1) {
        const x = boardX + col * cell;
        const y = boardY + row * cell;
        const tile = board[row]?.[col];
        const premium = premiumSquares[`${row},${col}`];

        ctx.fillStyle = premium ? PREMIUM_COLORS[premium] : "#243244";
        ctx.fillRect(x + 2, y + 2, cell - 4, cell - 4);

        if (tile) {
          drawRoundRect(
            ctx,
            x + tileInset,
            y + tileInset,
            cell - tileInset * 2,
            cell - tileInset * 2,
            tileRadius
          );
          ctx.fillStyle = tile.isBlank ? "#ffefc9" : "#f4e5c3";
          ctx.fill();
          ctx.fillStyle = "#4a3418";
          ctx.textAlign = "center";
          ctx.font = `800 ${letterFont}px Avenir Next, Segoe UI, sans-serif`;
          ctx.fillText(tile.letter.toUpperCase(), x + cell / 2, y + letterBaseline);
          ctx.font = `800 ${valueFont}px Avenir Next, Segoe UI, sans-serif`;
          ctx.textAlign = "right";
          ctx.fillText(
            String(tile.value),
            x + cell - cell * 0.2,
            y + cell - cell * 0.17
          );
        } else if (premium) {
          ctx.fillStyle = "rgba(255,255,255,0.82)";
          ctx.textAlign = "center";
          ctx.font = `800 ${premiumFont}px Avenir Next, Segoe UI, sans-serif`;
          ctx.fillText(PREMIUM_LABELS[premium], x + cell / 2, y + cell / 2 + premiumFont * 0.35);
        }
      }
    }

    ctx.fillStyle = "#eef3f8";
    ctx.font = "800 32px Avenir Next, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Play Friends With Words", SHARE_SIZE / 2, 1086);
    ctx.fillStyle = "#ffb74d";
    ctx.font = "700 28px Avenir Next, Segoe UI, sans-serif";
    ctx.fillText(playUrl, SHARE_SIZE / 2, 1132);

    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not export image"));
    }, "image/png");
  });

const Row = ({
  label,
  value,
  kind,
}: {
  label: string;
  value: number;
  kind?: "penalty" | "bonus";
}) => {
  if (value === 0 && kind) return null;
  const className = [
    "breakdown__row",
    kind ? `breakdown__row--${kind}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const sign = kind === "penalty" ? "-" : kind === "bonus" ? "+" : "";
  return (
    <div className={className}>
      <span>{label}</span>
      <strong>
        {sign}
        {Math.abs(value)}
      </strong>
    </div>
  );
};

export const GameOverPanel = ({
  breakdown,
  wordCount,
  best,
  syncState,
  board,
  premiumSquares,
  playUrl,
  rank,
  syncDetail = null,
  onShowLeaderboard,
  onPlayAgain,
  onMainMenu,
}: GameOverPanelProps) => {
  const [shareImageUrl, setShareImageUrl] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const isNewBest =
    best == null || breakdown.finalScore >= best.breakdown.finalScore;
  const shareFilename = useMemo(
    () => `friends-with-words-${breakdown.finalScore}.png`,
    [breakdown.finalScore]
  );

  useEffect(
    () => () => {
      if (shareImageUrl) URL.revokeObjectURL(shareImageUrl);
    },
    [shareImageUrl]
  );

  const handleShareScore = async () => {
    setShareStatus("Building share image...");
    try {
      const blob = await buildShareImage({
        board,
        premiumSquares,
        score: breakdown.finalScore,
        wordCount,
        playUrl,
      });
      const nextUrl = URL.createObjectURL(blob);
      setShareImageUrl((previousUrl) => {
        if (previousUrl) URL.revokeObjectURL(previousUrl);
        return nextUrl;
      });

      const file = new File([blob], shareFilename, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: "Friends With Words score",
          text: `I scored ${breakdown.finalScore} in ${getModeLabel(
            board
          )} on Friends With Words. Play here: ${playUrl}`,
          files: [file],
        });
        setShareStatus("Shared.");
      } else {
        setShareStatus("Image ready.");
      }
    } catch {
      setShareStatus("Could not create a share image.");
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2 className="modal__title">
          {isNewBest ? "New Best!" : "Time's Up!"}
        </h2>
        <div className="breakdown">
          <Row label={`Words played (${wordCount})`} value={breakdown.pointsEarned} />
          <Row label="Scrabble bonus" value={breakdown.scrabbleBonus} kind="bonus" />
          <Row
            label="Consistency bonus"
            value={breakdown.consistencyBonusTotal}
            kind="bonus"
          />
          <Row label="Swap penalties" value={breakdown.swapPenalties} kind="penalty" />
          <Row label="Turn penalties" value={breakdown.turnPenalties} kind="penalty" />
          <div className="breakdown__row breakdown__row--total">
            <span>Final score</span>
            <strong>{breakdown.finalScore}</strong>
          </div>
          {best && !isNewBest ? (
            <div className="breakdown__row">
              <span>Your best</span>
              <strong>{best.breakdown.finalScore}</strong>
            </div>
          ) : null}
          {rank != null ? (
            <div className="breakdown__row breakdown__row--rank">
              <span>Global rank</span>
              <strong>#{rank}</strong>
            </div>
          ) : null}
        </div>
        <p className="gameover__sync">
          {SYNC_TEXT[syncState]}
          {syncState === "rejected" && syncDetail ? ` (${syncDetail})` : ""}
        </p>
        <div className="gameover__actions">
          <button className="btn" onClick={handleShareScore}>
            Share Score
          </button>
          {onShowLeaderboard ? (
            <button className="btn" onClick={onShowLeaderboard}>
              Leaderboards
            </button>
          ) : null}
          <button className="btn btn--primary" onClick={onPlayAgain}>
            Play Again
          </button>
          <button className="btn" onClick={onMainMenu}>
            Main Menu
          </button>
        </div>
        {shareStatus ? <p className="gameover__share-status">{shareStatus}</p> : null}
        {shareImageUrl ? (
          <div className="gameover__share">
            <img src={shareImageUrl} alt="Shareable Friends With Words score" />
            <a className="btn btn--ghost" href={shareImageUrl} download={shareFilename}>
              Download Image
            </a>
            <p>
              Invite link: <span>{playUrl}</span>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
