"use client";

import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { toast } from "sonner";
import { FormShell } from "@/components/forms/FormShell";
import { Choice, TextField } from "@/components/forms/fields";
import { Loading } from "@/components/lists/common";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { updateGodownOnline } from "@/client/godown/manage";
import type { Godown } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { useAppSelector } from "@/store";

function ProfileForm({ g }: { g: Godown }) {
  const { t } = useI18n();
  const router = useRouter();
  const [s, setS] = useState({
    name: g.name,
    nameAlt: g.nameAlt ?? "",
    firmName: g.firmName ?? "",
    proprietor: g.proprietor ?? "",
    address: g.address ?? "",
    phone: g.phone ?? "",
    gstin: g.gstin ?? "",
    receiptLanguage: g.receiptLanguage,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const update = (patch: Partial<typeof s>) => {
    setS((x) => ({ ...x, ...patch }));
    setDirty(true);
  };
  const save = async () => {
    if (!s.name.trim()) return;
    setSaving(true);
    try {
      await updateGodownOnline({
        godownId: g._id,
        name: s.name.trim(),
        receiptLanguage: s.receiptLanguage,
        ...(s.nameAlt.trim() ? { nameAlt: s.nameAlt.trim() } : {}),
        ...(s.firmName.trim() ? { firmName: s.firmName.trim() } : {}),
        ...(s.proprietor.trim() ? { proprietor: s.proprietor.trim() } : {}),
        ...(s.address.trim() ? { address: s.address.trim() } : {}),
        ...(s.phone.trim() ? { phone: s.phone.trim() } : {}),
        ...(s.gstin.trim() ? { gstin: s.gstin.trim().toUpperCase() } : {}),
      });
      setDirty(false);
      toast.success(t("common.saved"));
      router.replace("/godowns");
    } catch (e) {
      toast.error(t(errorKey(e)));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormShell
      title={t("godowns.profileTitle", { godown: g.name })}
      dirty={dirty}
      saving={saving}
      onSubmit={() => void save()}
      backHref="/godowns"
      testId="godown-profile"
    >
      <p className="text-muted-foreground text-xs">{t("godowns.onlineOnly")}</p>
      <TextField
        label={t("godowns.name")}
        value={s.name}
        onChange={(name) => update({ name })}
        required
        maxLength={80}
      />
      <TextField
        label={t("godowns.nameAlt")}
        value={s.nameAlt}
        onChange={(nameAlt) => update({ nameAlt })}
        maxLength={80}
      />
      <TextField
        label={t("godowns.firmName")}
        value={s.firmName}
        onChange={(firmName) => update({ firmName })}
        maxLength={120}
      />
      <TextField
        label={t("godowns.proprietor")}
        value={s.proprietor}
        onChange={(proprietor) => update({ proprietor })}
        maxLength={120}
      />
      <TextField
        label={t("godowns.address")}
        value={s.address}
        onChange={(address) => update({ address })}
        multiline
        maxLength={300}
      />
      <TextField
        label={t("godowns.phone")}
        value={s.phone}
        onChange={(phone) => update({ phone })}
        inputMode="tel"
        maxLength={20}
      />
      <TextField
        label={t("godowns.gstin")}
        value={s.gstin}
        onChange={(gstin) => update({ gstin })}
        maxLength={15}
      />
      <Choice
        label={t("receipt.language")}
        value={s.receiptLanguage}
        onChange={(receiptLanguage) => update({ receiptLanguage })}
        options={[
          { value: "bn", label: t("lang.bn") },
          { value: "en", label: t("lang.en") },
          { value: "both", label: t("receipt.both") },
        ]}
      />
    </FormShell>
  );
}

function Inner() {
  const id = useParam("id");
  const isOwner = useAppSelector((s) => s.session.isOwner);
  const g = useLiveQuery(async () => (id ? ((await db().godowns.get(id)) ?? null) : null), [id]);
  if (!isOwner) return <ReadOnlyNotice reason="viewer" />;
  if (g === undefined) return <Loading />;
  if (!g) return <ReadOnlyNotice reason="notFound" />;
  if (g.status === "archived") return <ReadOnlyNotice reason="archived" />;
  return <ProfileForm key={`${g._id}:${g.rev}`} g={g} />;
}

/** Godown profile & letterhead (owner, online): `?id=`. */
export default function GodownEditPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}
