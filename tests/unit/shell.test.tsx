// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import HomePage from "@/app/(app)/page";
import { Providers } from "@/app/providers";

beforeAll(() => {
  // jsdom lacks matchMedia (used by next-themes / sonner).
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("app shell (bn ⇄ en without reload)", () => {
  it("renders Bengali by default and switches to English instantly", async () => {
    render(
      <Providers>
        <HomePage />
      </Providers>,
    );
    expect(await screen.findByText("ধান খাতা")).toBeTruthy();
    expect(screen.getByText("₹২৬,০৬৮.৭৫")).toBeTruthy();
    expect(screen.getByText("ছাব্বিশ হাজার আটষট্টি টাকা পঁচাত্তর পয়সা মাত্র")).toBeTruthy();
    expect(document.documentElement.lang).toBe("bn");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ভাষা পরিবর্তন" }));
    });
    expect(screen.getByText("Dhan Khata")).toBeTruthy();
    expect(
      screen.getByText("Rupees Twenty-Six Thousand Sixty-Eight and Seventy-Five Paise Only"),
    ).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    // Digit style is independent of language.
    expect(screen.getByText("₹২৬,০৬৮.৭৫")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "English 012" }));
    });
    expect(screen.getByText("₹26,068.75")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("dk.locale.v1") ?? "{}")).toMatchObject({
      lang: "en",
      digits: "en",
    });
  });
});
