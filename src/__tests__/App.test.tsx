import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { PROFILE_KEY } from "../services/usernameService";

// jsdom lacks ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const seedProfile = () => {
  localStorage.setItem(
    PROFILE_KEY,
    JSON.stringify({ username: "TestPlayer", verified: false, savedAtMs: 1 })
  );
  localStorage.setItem("fwwweb.comboExplained.v1", "1");
};

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("requires a username before starting", async () => {
    render(<App />);
    expect(screen.getByLabelText(/pick a username/i)).toBeTruthy();
    const start = await screen.findByRole("button", { name: /start rush/i });
    expect((start as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the combo explainer before the first run, then starts", async () => {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ username: "TestPlayer", verified: false, savedAtMs: 1 })
    );
    render(<App />);
    const start = await screen.findByRole("button", { name: /start rush/i });
    await vi.waitFor(() => {
      expect((start as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(start);
    });
    // First run: explainer appears instead of the board.
    expect(screen.getByText(/combo bonuses/i)).toBeTruthy();

    const go = screen.getByRole("button", { name: /got it/i });
    await act(async () => {
      fireEvent.click(go);
    });
    expect(document.querySelectorAll(".cell")).toHaveLength(121);
    expect(localStorage.getItem("fwwweb.comboExplained.v1")).toBe("1");
  });

  it("renders the menu and starts a run when already set up", async () => {
    seedProfile();
    render(<App />);
    expect(screen.getByText(/5-Minute Rush/i)).toBeTruthy();
    expect(screen.getByText(/TestPlayer/)).toBeTruthy();

    const start = await screen.findByRole("button", { name: /start rush/i });
    await vi.waitFor(() => {
      expect((start as HTMLButtonElement).disabled).toBe(false);
    });

    await act(async () => {
      fireEvent.click(start);
    });

    // Board renders 121 cells and the rack shows 7 tiles.
    expect(document.querySelectorAll(".cell")).toHaveLength(121);
    expect(document.querySelectorAll("[data-rack-tile]")).toHaveLength(7);
    expect(screen.getByRole("timer").textContent).toBe("5:00");
    expect(screen.getByRole("button", { name: /submit/i })).toBeTruthy();
  });

  it("pauses from the menu button and resumes", async () => {
    seedProfile();
    render(<App />);
    const start = await screen.findByRole("button", { name: /start rush/i });
    await vi.waitFor(() => {
      expect((start as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(start);
    });

    fireEvent.click(screen.getByRole("button", { name: /menu/i }));
    expect(screen.getByText(/paused/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /resume/i }));
    expect(screen.queryByText(/paused/i)).toBeNull();
  });

  it("offers to resume when an autosave exists", async () => {
    seedProfile();
    const first = render(<App />);
    const start = await first.findByRole("button", { name: /start rush/i });
    await vi.waitFor(() => {
      expect((start as HTMLButtonElement).disabled).toBe(false);
    });
    await act(async () => {
      fireEvent.click(start);
    });
    first.unmount();

    render(<App />);
    const resume = await screen.findByRole("button", { name: /resume run/i });
    await act(async () => {
      fireEvent.click(resume);
    });
    expect(document.querySelectorAll(".cell")).toHaveLength(121);
  });
});
