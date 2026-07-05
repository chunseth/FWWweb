import type { RushScoreBreakdown } from "../game/shared/types";
import type { LocalRushResult } from "../game/rush/localResults";

interface GameOverPanelProps {
  breakdown: RushScoreBreakdown;
  wordCount: number;
  best: LocalRushResult | null;
  onPlayAgain: () => void;
}

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
  onPlayAgain,
}: GameOverPanelProps) => {
  const isNewBest =
    best == null || breakdown.finalScore >= best.breakdown.finalScore;

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
        </div>
        <p className="gameover__sync">
          Saved on this device. Public leaderboard opens once server-verified
          scoring ships.
        </p>
        <div className="gameover__actions">
          <button className="btn btn--primary" onClick={onPlayAgain}>
            Play Again
          </button>
        </div>
      </div>
    </div>
  );
};
