// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Providers } from "@/app/providers";
import { amountInWords } from "@/domain/amountInWords";
import { useI18n } from "@/i18n/I18nProvider";

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

/** App title + golden case G1 rendered through the live i18n context (no router needed). */
function Probe() {
  const { t, lang, setLang, setDigits, money } = useI18n();
  return (
    <div>
      <h1>{t("common.appName")}</h1>
      <span data-testid="money">{money(2606875n)}</span>
      <span data-testid="words">{amountInWords(2606875n, lang)}</span>
      <button onClick={() => setLang(lang === "bn" ? "en" : "bn")}>lang</button>
      <button onClick={() => setDigits("en")}>digits</button>
    </div>
  );
}

describe("app shell (bn ⇄ en without reload)", () => {
  it("renders Bengali by default and switches to English instantly", async () => {
    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(await screen.findByText("ধান গোলা")).toBeTruthy();
    expect(screen.getByTestId("money").textContent).toBe("₹২৬,০৬৮.৭৫");
    expect(screen.getByTestId("words").textContent).toBe(
      "ছাব্বিশ হাজার আটষট্টি টাকা পঁচাত্তর পয়সা মাত্র",
    );
    expect(document.documentElement.lang).toBe("bn");

    await act(async () => {
      fireEvent.click(screen.getByText("lang"));
    });
    expect(screen.getByText("Dhan Gola")).toBeTruthy();
    expect(screen.getByTestId("words").textContent).toBe(
      "Rupees Twenty-Six Thousand Sixty-Eight and Seventy-Five Paise Only",
    );
    expect(document.documentElement.lang).toBe("en");
    // Digit style is independent of language.
    expect(screen.getByTestId("money").textContent).toBe("₹২৬,০৬৮.৭৫");
    await act(async () => {
      fireEvent.click(screen.getByText("digits"));
    });
    expect(screen.getByTestId("money").textContent).toBe("₹26,068.75");
    expect(JSON.parse(window.localStorage.getItem("dk.locale.v1") ?? "{}")).toMatchObject({
      lang: "en",
      digits: "en",
    });
  });
});
