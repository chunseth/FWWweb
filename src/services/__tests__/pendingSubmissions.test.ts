import { describe, expect, it, vi } from "vitest";
import {
  enqueueSubmission,
  loadPendingSubmissions,
  PENDING_SUBMISSIONS_KEY,
  processPendingSubmissions,
} from "../pendingSubmissions";
import type { PendingSubmission } from "../pendingSubmissions";
import type { StorageLike } from "../../game/rush/autosave";
import type { SubmitOutcome } from "../rushRunService";

const makeStorage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const entry = (
  runId: string,
  deadlineAtMs: number
): PendingSubmission => ({
  runId,
  seed: `seed-${runId}`,
  journal: [
    {
      type: "swap",
      turn: 1,
      rackIndices: [0],
      penalty: 1,
      atElapsedMs: 1000,
    },
  ],
  deadlineAtMs,
  queuedAtMs: 0,
});

describe("pending submission queue", () => {
  it("enqueues, deduplicates by runId, and caps the queue", () => {
    const storage = makeStorage();
    enqueueSubmission(entry("a", 10_000), storage);
    enqueueSubmission(entry("a", 20_000), storage); // replaces
    enqueueSubmission(entry("b", 10_000), storage);

    const loaded = loadPendingSubmissions(storage);
    expect(loaded).toHaveLength(2);
    expect(loaded.find((e) => e.runId === "a")?.deadlineAtMs).toBe(20_000);
  });

  it("submits queued entries and removes them on acceptance", async () => {
    const storage = makeStorage();
    enqueueSubmission(entry("a", Date.now() + 60_000), storage);

    const submit = vi.fn(
      async (): Promise<SubmitOutcome> => ({
        status: "accepted",
        finalScore: 42,
        improved: true,
        rank: 7,
        personalBest: 42,
      })
    );
    const result = await processPendingSubmissions(submit, storage);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ submitted: 1, dropped: 0, kept: 0 });
    expect(loadPendingSubmissions(storage)).toHaveLength(0);
  });

  it("keeps entries on network failure for a later retry", async () => {
    const storage = makeStorage();
    enqueueSubmission(entry("a", Date.now() + 60_000), storage);

    const submit = vi.fn(
      async (): Promise<SubmitOutcome> => ({ status: "network" })
    );
    const result = await processPendingSubmissions(submit, storage);

    expect(result.kept).toBe(1);
    expect(loadPendingSubmissions(storage)).toHaveLength(1);
  });

  it("drops rejected entries — retrying cannot change the server's answer", async () => {
    const storage = makeStorage();
    enqueueSubmission(entry("a", Date.now() + 60_000), storage);

    const submit = vi.fn(
      async (): Promise<SubmitOutcome> => ({
        status: "rejected",
        reason: "replay_rejected",
      })
    );
    const result = await processPendingSubmissions(submit, storage);

    expect(result.dropped).toBe(1);
    expect(loadPendingSubmissions(storage)).toHaveLength(0);
  });

  it("drops entries past the grace deadline without calling the server", async () => {
    const storage = makeStorage();
    enqueueSubmission(entry("late", 1_000), storage);

    const submit = vi.fn();
    const result = await processPendingSubmissions(
      submit as never,
      storage,
      () => 999_999
    );

    expect(submit).not.toHaveBeenCalled();
    expect(result.dropped).toBe(1);
    expect(loadPendingSubmissions(storage)).toHaveLength(0);
  });

  it("survives corrupt queue data", () => {
    const storage = makeStorage();
    storage.setItem(PENDING_SUBMISSIONS_KEY, "{corrupt!!");
    expect(loadPendingSubmissions(storage)).toEqual([]);
  });
});
