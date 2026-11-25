// @vitest-environment jsdom
/**
 * Voice input (requirement_v2 §14.1): no SpeechRecognition → a disabled mic that says "type
 * instead"; a spoken Bengali number is parsed locally and shown for confirmation before it fills
 * the field; text mode inserts the transcript.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Providers } from "@/app/providers";
import { VoiceButton } from "@/components/voice/VoiceButton";

beforeAll(() => {
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
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
});

let heard = "";
class FakeRecognition {
  lang = "";
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    queueMicrotask(() => {
      this.onresult?.({ results: [[{ transcript: heard }]] });
      this.onend?.();
    });
  }
  stop() {}
}

describe("VoiceButton", () => {
  it("is a disabled mic when the browser has no speech recognition", async () => {
    render(
      <Providers>
        <VoiceButton mode="text" onText={() => {}} testId="f" />
      </Providers>,
    );
    const mic = await screen.findByTestId("f-mic");
    expect(mic.getAttribute("data-voice")).toBe("off");
    expect(mic.getAttribute("title")).toBe("এই ফোনে ভয়েস চলে না — টাইপ করুন");
  });

  it("parses a spoken Bengali number and fills it only after confirmation", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    heard = "বাহান্ন দশমিক পাঁচ";
    const onText = vi.fn();
    render(
      <Providers>
        <VoiceButton mode="number" onText={onText} testId="rate" />
      </Providers>,
    );
    const mic = await screen.findByTestId("rate-mic");
    expect(mic.getAttribute("data-voice")).toBe("on");
    await act(async () => {
      fireEvent.click(mic);
      await Promise.resolve();
    });
    expect(onText).not.toHaveBeenCalled();
    expect(await screen.findByText("শুনলাম: ৫২.৫")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("এটা বসান"));
    expect(onText).toHaveBeenCalledWith("52.5");
  });

  it("inserts the transcript in text mode", async () => {
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognition;
    heard = "রহিম শেখ";
    const onText = vi.fn();
    render(
      <Providers>
        <VoiceButton mode="text" onText={onText} testId="name" />
      </Providers>,
    );
    await act(async () => {
      fireEvent.click(await screen.findByTestId("name-mic"));
      await Promise.resolve();
    });
    expect(onText).toHaveBeenCalledWith("রহিম শেখ");
  });
});
