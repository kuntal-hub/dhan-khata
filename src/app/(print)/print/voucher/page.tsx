"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Loading } from "@/components/lists/common";
import { PrintFrame, type ReceiptLang } from "@/components/print/PrintFrame";
import { ReceiptBody } from "@/components/print/Receipt";
import { PageSuspense, ReadOnlyNotice, useParam } from "@/components/system/page";
import { useNames } from "@/components/vouchers/names";
import { db } from "@/client/db/dexie";
import type { Godown, Voucher } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";

function Inner() {
  const id = useParam("id");
  const data = useLiveQuery(async () => {
    if (!id) return null;
    const v = await db().vouchers.get(id);
    if (!v) return null;
    const godown = await db().godowns.get(v.godownId);
    return godown ? { v, godown } : null;
  }, [id]);
  const names = useNames(data ? data.godown._id : null);
  if (data === undefined || (data && !names)) return <Loading />;
  if (!data || !names) return <ReadOnlyNotice reason="notFound" />;
  return <Printable v={data.v} godown={data.godown} names={names} />;
}

function Printable({
  v,
  godown,
  names,
}: {
  v: Voucher;
  godown: Godown;
  names: NonNullable<ReturnType<typeof useNames>>;
}) {
  const { t } = useI18n();
  const [lang, setLang] = useState<ReceiptLang>(godown.receiptLanguage);
  return (
    <PrintFrame
      title={`${t("receipt.receipt")} · ${v.number}`}
      filename={v.number}
      receiptLang={lang}
      onReceiptLang={setLang}
    >
      {lang === "both" ? (
        <div className="grid grid-cols-2 gap-4">
          <ReceiptBody v={v} godown={godown} lang="bn" names={names} />
          <ReceiptBody v={v} godown={godown} lang="en" names={names} />
        </div>
      ) : (
        <ReceiptBody v={v} godown={godown} lang={lang} names={names} />
      )}
    </PrintFrame>
  );
}

/** Receipt print / share view (spec §J). */
export default function PrintVoucherPage() {
  return (
    <PageSuspense>
      <Inner />
    </PageSuspense>
  );
}
