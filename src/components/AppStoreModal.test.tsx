import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppStoreModal, APP_STORE_URL } from "./AppStoreModal";

describe("AppStoreModal", () => {
  it("dismisses when OK is clicked", () => {
    const onDismiss = vi.fn();
    render(<AppStoreModal onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: /^ok$/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses when the App Store link is clicked", () => {
    const onDismiss = vi.fn();
    render(<AppStoreModal onDismiss={onDismiss} />);

    const link = screen.getByRole("link", { name: /download on the app store/i });
    expect(link.getAttribute("href")).toBe(APP_STORE_URL);
    fireEvent.click(link);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
