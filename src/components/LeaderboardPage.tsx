import { useEffect, useState } from "react";
import {
  fetchRushLeaderboard,
  fetchRushRank,
} from "../services/rushRunService";
import type { LeaderboardRow } from "../services/rushRunService";
import { getBestLocalResult } from "../game/rush/localResults";
import { loadProfile } from "../services/usernameService";

type Phase =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; rows: LeaderboardRow[] };

const MEDALS = ["🥇", "🥈", "🥉"];

interface LeaderboardPageProps {
  onBack: () => void;
}

/**
 * Full-page global leaderboard — exclusively 5-minute Rush scores, read via
 * the safe get_rush_leaderboard RPC (best score per player, no player ids).
 */
export const LeaderboardPage = ({ onBack }: LeaderboardPageProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [yourRank, setYourRank] = useState<number | null>(null);

  const profile = loadProfile();
  const best = getBestLocalResult();

  useEffect(() => {
    let cancelled = false;
    void fetchRushLeaderboard(50).then((rows) => {
      if (cancelled) return;
      setPhase(rows ? { kind: "ready", rows } : { kind: "unavailable" });
    });
    const bestScore = getBestLocalResult()?.breakdown.finalScore;
    if (typeof bestScore === "number") {
      void fetchRushRank(bestScore).then((rank) => {
        if (!cancelled) setYourRank(rank);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen screen--leaderboard">
      <header className="lb-page__header">
        <button className="btn btn--ghost lb-page__back" onClick={onBack}>
          ← Back
        </button>
        <div className="lb-page__heading">
          <h1 className="lb-page__title">Leaderboard</h1>
          <p className="lb-page__subtitle">5-Minute Rush · 11×11</p>
        </div>
      </header>

      {phase.kind === "loading" ? (
        <p className="leaderboard__note">Loading scores…</p>
      ) : phase.kind === "unavailable" ? (
        <p className="leaderboard__note">
          Leaderboard unavailable right now — check back later.
        </p>
      ) : phase.rows.length === 0 ? (
        <p className="leaderboard__note">No scores yet. Set the first one!</p>
      ) : (
        <ol className="leaderboard leaderboard--page">
          {phase.rows.map((row) => {
            const isYou =
              profile != null && row.displayName === profile.username;
            return (
              <li
                key={`${row.rank}-${row.displayName}`}
                className={`leaderboard__row${
                  isYou ? " leaderboard__row--you" : ""
                }`}
              >
                <span className="leaderboard__rank">
                  {MEDALS[row.rank - 1] ?? row.rank}
                </span>
                <span className="leaderboard__name">
                  {row.displayName}
                  {isYou ? " (you)" : ""}
                </span>
                <strong className="leaderboard__score">{row.finalScore}</strong>
              </li>
            );
          })}
        </ol>
      )}

      {best ? (
        <footer className="lb-page__you">
          Your best: <strong>{best.breakdown.finalScore}</strong>
          {yourRank != null ? (
            <>
              {" "}
              · Global rank <strong>#{yourRank}</strong>
            </>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
};
