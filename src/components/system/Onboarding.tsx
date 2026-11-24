"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { Upload, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Choice, TextField } from "@/components/forms/fields";
import { GodownWizard } from "@/components/godown/GodownWizard";
import { addUserOnline, restoreOnline, savePrefsOnline } from "@/client/admin";
import { db } from "@/client/db/dexie";
import { setMeta } from "@/client/db/meta";
import { errorKey } from "@/client/errors";
import { useSessionMeta } from "@/client/hooks";
import { getSyncEngine } from "@/client/sync/instance";
import type { GodownRole } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

export const ONBOARDING_KEY = "onboarding";
export type Step = "language" | "profile" | "godown" | "users";
const STEP_LABEL = {
  language: "onboard.stepLanguage",
  profile: "onboard.stepProfile",
  godown: "onboard.stepGodown",
  users: "onboard.stepUsers",
} as const;

/** The first-run wizard itself (loaded lazily by OnboardingGate). */
export default function Onboarding({ initial }: { initial: Step }) {
  const { t, lang, setLang, digits, setDigits } = useI18n();
  const session = useSessionMeta();
  const [step, setStepState] = useState<Step>(initial === ("done" as Step) ? "language" : initial);
  const [name, setName] = useState(session?.user.name ?? "");
  const [godownId, setGodownId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const setStep = (s: Step | "done") => {
    void setMeta(ONBOARDING_KEY, s);
    if (s !== "done") setStepState(s);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  const steps: Step[] = ["language", "profile", "godown", "users"];
  return (
    <main
      className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 p-4"
      data-testid="onboarding"
    >
      <h1 className="text-primary text-2xl font-semibold">{t("onboard.title")}</h1>
      <ol className="text-muted-foreground flex list-inside list-decimal flex-wrap gap-x-4 text-xs">
        {steps.map((s) => (
          <li key={s} className={s === step ? "text-primary font-semibold" : ""}>
            {t(STEP_LABEL[s])}
          </li>
        ))}
      </ol>
      {step === "language" ? (
        <>
          <Choice
            label={t("common.language")}
            value={lang}
            onChange={setLang}
            options={[
              { value: "bn", label: t("lang.bn") },
              { value: "en", label: t("lang.en") },
            ]}
          />
          <Choice
            label={t("common.digits")}
            value={digits}
            onChange={setDigits}
            options={[
              { value: "bn", label: t("lang.digitsBn") },
              { value: "en", label: t("lang.digitsEn") },
            ]}
          />
          <Button className="h-12" onClick={() => setStep("profile")} data-testid="onboard-next">
            {t("common.next")}
          </Button>
          <div className="flex flex-col gap-1 border-t pt-3">
            <Button
              variant="ghost"
              className="h-11"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              {t("onboard.restoreOption")}
            </Button>
            <p className="text-muted-foreground text-xs">{t("backup.restoreHint")}</p>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                void run(async () => {
                  await restoreOnline(JSON.parse(await f.text()) as unknown);
                  toast.success(t("backup.restored"));
                  setStep("done");
                  await getSyncEngine().syncNow();
                });
              }}
            />
          </div>
        </>
      ) : null}
      {step === "profile" ? (
        <>
          <TextField
            label={t("onboard.ownerName")}
            value={name}
            onChange={setName}
            required
            maxLength={80}
          />
          <Button
            className="h-12"
            disabled={!name.trim() || busy}
            onClick={() =>
              void run(async () => {
                await savePrefsOnline({ language: lang, digits, name: name.trim() });
                setStep("godown");
              })
            }
            data-testid="onboard-next"
          >
            {t("common.next")}
          </Button>
        </>
      ) : null}
      {step === "godown" ? (
        <GodownWizard
          onFinished={(id) => {
            setGodownId(id);
            setStep("users");
          }}
        />
      ) : null}
      {step === "users" ? <InviteUsers godownId={godownId} onDone={() => setStep("done")} /> : null}
    </main>
  );
}

function InviteUsers({ godownId, onDone }: { godownId: string | null; onDone: () => void }) {
  const { t } = useI18n();
  const firstGodown = useLiveQuery(
    async () => godownId ?? (await db().godowns.toCollection().first())?._id,
    [godownId],
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<GodownRole>("manager");
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!firstGodown) return;
    setBusy(true);
    try {
      await addUserOnline({
        name: name.trim(),
        phone: phone.trim(),
        password,
        godownAccess: [{ godownId: firstGodown, role }],
      });
      setAdded((a) => [...a, name.trim()]);
      setName("");
      setPhone("");
      setPassword("");
      toast.success(t("users.created"));
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("onboard.inviteHint")}</p>
      {added.length ? <p className="text-sm">{added.join(", ")}</p> : null}
      <TextField label={t("users.name")} value={name} onChange={setName} />
      <TextField label={t("users.phone")} value={phone} onChange={setPhone} inputMode="tel" />
      <TextField label={t("users.password")} value={password} onChange={setPassword} />
      <Choice
        value={role}
        onChange={setRole}
        options={[
          { value: "manager", label: t("role.manager") },
          { value: "entry", label: t("role.entry") },
          { value: "viewer", label: t("role.viewer") },
        ]}
      />
      <Button
        variant="outline"
        className="h-11"
        disabled={busy || !name.trim() || phone.trim().length < 10 || password.length < 6}
        onClick={() => void add()}
      >
        <UserPlus className="size-4" aria-hidden />
        {t("users.add")}
      </Button>
      <Button className="h-12" onClick={onDone} data-testid="onboard-finish">
        {t("onboard.finish")}
      </Button>
    </div>
  );
}
