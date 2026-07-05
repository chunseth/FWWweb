import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameHud } from "./GameHud";

const renderHud = (remainingMs: number) =>
  render(
    <GameHud
      remainingMs={remainingMs}
      score={0}
      tilesRemaining={7}
      comboStreak={0}
      onMenu={() => {}}
    />
  );

describe("GameHud", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("hides a threshold banner even while the clock keeps ticking", () => {
    const { rerender } = renderHud(121_000);

    rerender(
      <GameHud
        remainingMs={119_900}
        score={0}
        tilesRemaining={7}
        comboStreak={0}
        onMenu={() => {}}
      />
    );
    expect(screen.getByText("2 minutes remaining")).toBeTruthy();

    rerender(
      <GameHud
        remainingMs={119_700}
        score={0}
        tilesRemaining={7}
        comboStreak={0}
        onMenu={() => {}}
      />
    );

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText("2 minutes remaining")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.queryByText("2 minutes remaining")).toBeNull();
  });
});
