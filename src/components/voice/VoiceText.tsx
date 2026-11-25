"use client";

/** A text field with a mic (notes, expense title …; requirement_v2 §14.1). */
import { Input } from "@/components/ui/input";
import { VoiceButton } from "./VoiceButton";

export function VoiceText({
  value,
  onChange,
  testId,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className="border-input focus-within:ring-ring/50 flex h-12 items-center rounded-md border pr-1 focus-within:ring-[3px]">
      <Input
        id={id}
        className="h-full border-0 text-base shadow-none focus-visible:ring-0"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
      <VoiceButton
        mode="text"
        onText={(text) => onChange(value.trim() ? `${value.trim()} ${text}` : text)}
        {...(testId ? { testId } : {})}
      />
    </div>
  );
}
