/**
 * Offline queue for leaderboard submissions.
 *
 * If a run ends while offline, its journal is queued here and retried when
 * the app loads or the browser comes back online. The server's deadline
 * (started_at + 300s + 60s grace) still applies: entries past their deadline
 * are dropped locally (the result stays saved on-device as local_only) and
 * would be rejected server-side anyway.
 */

import { submitRushRunToServer } from "./rushRunService";
import type { SubmitOutcome } from "./rushRunService";
import type { RushTurnEntry } from "../game/shared/types";
import type { StorageLike } from "../game/rush/autosave";

export const PENDING_SUBMISSIONS_KEY = "fwwweb.rush.pendingSubmissions.v1";
const MAX_QUEUE = 10;

export interface PendingSubmission {
  runId: string;
  seed: string;
  journal: RushTurnEntry[];
  displayName?: string;
  deadlineAtMs: number;
  queuedAtMs: number;
}

type Submitter = (
  runId: string,
  journal: RushTurnEntry[],
  displayName?: string
) => Promise<SubmitOutcome>;

const defaultStorage = (): StorageLike | null => {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* storage disabled */
  }
  return null;
};

export const loadPendingSubmissions = (
  storage: StorageLike | null = defaultStorage()
): PendingSubmission[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(PENDING_SUBMISSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PendingSubmission =>
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.runId === "string" &&
        typeof entry.seed === "string" &&
        Array.isArray(entry.journal) &&
        typeof entry.deadlineAtMs === "number"
    );
  } catch {
    return [];
  }
};

const save = (
  entries: PendingSubmission[],
  storage: StorageLike | null
): void => {
  try {
    storage?.setItem(PENDING_SUBMISSIONS_KEY, JSON.stringify(entries));
  } catch {
    /* quota exceeded: drop silently, local result is still saved */
  }
};

export const enqueueSubmission = (
  submission: PendingSubmission,
  storage: StorageLike | null = defaultStorage()
): void => {
  const existing = loadPendingSubmissions(storage).filter(
    (entry) => entry.runId !== submission.runId
  );
  save([submission, ...existing].slice(0, MAX_QUEUE), storage);
};

export interface ProcessResult {
  submitted: number;
  dropped: number;
  kept: number;
}

/**
 * Try to flush the queue. Accepted and logically-rejected entries leave the
 * queue; network failures stay for the next attempt; expired entries drop.
 */
export const processPendingSubmissions = async (
  submit: Submitter = submitRushRunToServer,
  storage: StorageLike | null = defaultStorage(),
  now: () => number = Date.now
): Promise<ProcessResult> => {
  const entries = loadPendingSubmissions(storage);
  if (entries.length === 0) return { submitted: 0, dropped: 0, kept: 0 };

  const kept: PendingSubmission[] = [];
  let submitted = 0;
  let dropped = 0;

  for (const entry of entries) {
    if (now() > entry.deadlineAtMs) {
      dropped += 1; // grace window passed: stays local_only
      continue;
    }
    const outcome = await submit(entry.runId, entry.journal, entry.displayName);
    if (outcome.status === "accepted") {
      submitted += 1;
    } else if (outcome.status === "rejected") {
      dropped += 1; // server said no; retrying cannot change the answer
    } else {
      kept.push(entry); // network: try again later
    }
  }

  save(kept, storage);
  return { submitted, dropped, kept: kept.length };
};
