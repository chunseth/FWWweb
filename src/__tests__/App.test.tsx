import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

// jsdom lacks ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("renders the menu and starts a run", async () => {
    render(<App />);
    expect(screen.getByText(/5-Minute Rush/i)).toBeTruthy();

    const start = await screen.findByRole("button", { name: /start rush/i });
    // Dictionary load is async; wait for the button to enable.
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

  it("offers to resume when an autosave exists", async () => {
    // Seed an autosave by starting a run in a first mount.
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
