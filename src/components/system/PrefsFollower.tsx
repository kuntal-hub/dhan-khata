"use client";

import { useEffect } from "react";
import { getMeta, setMeta } from "@/client/db/meta";
import { useSessionMeta } from "@/client/hooks";
import { useI18n } from "@/i18n/I18nProvider";

const SEEN_KEY = "prefsSeen";

/**
 * Language / digits follow the user (spec §11.4): when the synced user record carries a
 * preference this device hasn't applied yet (first login on a new phone, or a change made on
 * another phone), apply it. Local changes are saved to the user record from Settings.
 */
export function PrefsFollower() {
  const session = useSessionMeta();
  const { setLang, setDigits } = useI18n();
  const language = session?.user.language;
  const digits = session?.user.digits;
  useEffect(() => {
    if (!language || !digits) return;
    const sig = `${language}|${digits}`;
    void getMeta<string>(SEEN_KEY).then(async (seen) => {
      if (seen === sig) return;
      await setMeta(SEEN_KEY, sig);
      setLang(language);
      setDigits(digits);
    });
  }, [language, digits, setLang, setDigits]);
  return null;
}
