"use client";

/**
 * "পেমেন্ট দিলাম / টাকা পেলাম" (requirement_v2 §11 quick actions, §12.6): pick the party, then pay
 * or collect across its open bills (oldest first, editable) with the rest as an advance.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PayAcross } from "@/components/dues/PayAcross";
import { PartyPicker } from "@/components/entry/Fields";
import { PageTitle } from "@/components/shell/PageTitle";
import {
  Fresh,
  PageSuspense,
  ReadOnlyNotice,
  useParam,
  useWriteGodown,
} from "@/components/system/page";
import { useI18n } from "@/i18n/I18nProvider";

function Pay() {
  const { t } = useI18n();
  const router = useRouter();
  const direction = useParam("direction") === "IN" ? "IN" : "OUT";
  const preset = useParam("party");
  const { godown, readOnly } = useWriteGodown();
  const [partyId, setPartyId] = useState<string | undefined>(preset);
  if (readOnly || !godown) return <ReadOnlyNotice reason={readOnly ?? "noGodown"} />;
  return (
    <div className="flex flex-col gap-4" data-testid="due-pay">
      <PageTitle
        title={t(direction === "OUT" ? "quick.paid" : "quick.received")}
        subtitle={godown.name}
        back="/dues"
      />
      <PartyPicker
        godownId={godown._id}
        roles={[
          "FARMER",
          "SUPPLIER",
          "CUSTOMER",
          "MILL",
          "SECOND_PARTY",
          "VEHICLE_CUSTOMER",
          "DRIVER",
          "LABOUR",
          "OTHER",
          "GOLA",
          "TRANSPORTER",
        ]}
        createRole={direction === "OUT" ? "FARMER" : "CUSTOMER"}
        value={partyId}
        onChange={setPartyId}
        label={t("mill.spParty")}
        testId="due-pay-party"
      />
      {partyId ? (
        <PayAcross
          key={partyId}
          godownId={godown._id}
          partyId={partyId}
          direction={direction}
          onDone={() => router.replace(`/dues/party?id=${partyId}`)}
        />
      ) : null}
    </div>
  );
}

export default function DuePayPage() {
  return (
    <PageSuspense>
      <Fresh>
        <Pay />
      </Fresh>
    </PageSuspense>
  );
}
