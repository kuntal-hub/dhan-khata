"use client";

/**
 * Vehicles of the Gola (requirement_v2 §10 Vehicle, §12.7): picker with inline "+ নতুন গাড়ি" and
 * the small vehicle form (number normalised to WB12AB3456, own / external, driver name, mobile).
 */
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { FieldBox, Segmented } from "@/components/entry/Fields";
import { EntityPicker, type PickerItem } from "@/components/forms/EntityPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db } from "@/client/db/dexie";
import { errorKey } from "@/client/errors";
import { upsertMaster } from "@/client/repo";
import type { Vehicle } from "@/domain/schemas";
import { useI18n } from "@/i18n/I18nProvider";
import { displayVehicleNumber } from "@/domain/vehicleNumber";

export const normalizeVehicleNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function VehicleForm({
  godownId,
  existing,
  initial = "",
  onDone,
  onCancel,
}: {
  godownId: string;
  existing?: Vehicle;
  initial?: string;
  onDone: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [number, setNumber] = useState(existing?.number ?? normalizeVehicleNumber(initial));
  const [own, setOwn] = useState<Vehicle["ownership"]>(existing?.ownership ?? "own");
  const [driver, setDriver] = useState(existing?.driverName ?? "");
  const [mobile, setMobile] = useState(existing?.driverMobile ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3" data-testid="vehicle-form">
      <FieldBox label={t("veh.number")}>
        <Input
          className="h-12 text-base uppercase"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          autoFocus
          data-testid="vehicle-number"
        />
      </FieldBox>
      <FieldBox label={t("veh.ownership")}>
        <Segmented
          label={t("veh.ownership")}
          value={own}
          options={[
            ["own", t("veh.own")],
            ["external", t("veh.external")],
          ]}
          onChange={setOwn}
          testId="vehicle-ownership"
        />
      </FieldBox>
      <div className="grid grid-cols-2 gap-3">
        <FieldBox label={t("veh.driver")}>
          <Input
            className="h-12 text-base"
            value={driver}
            onChange={(e) => setDriver(e.target.value)}
          />
        </FieldBox>
        <FieldBox label={t("veh.driverMobile")}>
          <Input
            className="h-12 text-base"
            inputMode="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
          />
        </FieldBox>
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button
          className="h-12"
          data-testid="vehicle-save"
          onClick={async () => {
            const n = normalizeVehicleNumber(number);
            if (n.length < 2) return setError(t("errors.validation.vehicleNumber"));
            try {
              const v = await upsertMaster(godownId, "vehicle", {
                ...(existing ? { _id: existing._id } : {}),
                number: n,
                ownership: own,
                ...(driver.trim() ? { driverName: driver.trim() } : {}),
                ...(mobile.trim() ? { driverMobile: mobile.trim() } : {}),
              });
              onDone(v._id);
            } catch (e) {
              setError(t(errorKey(e)));
            }
          }}
        >
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

export function VehiclePicker({
  godownId,
  value,
  onChange,
  testId,
  error,
}: {
  godownId: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  testId: string;
  error?: string | null;
}) {
  const { t } = useI18n();
  const items = useLiveQuery(async (): Promise<PickerItem[]> => {
    const vs = await db().vehicles.where("godownId").equals(godownId).toArray();
    return vs
      .filter((v) => v.status === "active")
      .sort((a, b) => a.number.localeCompare(b.number))
      .map((v) => ({
        id: v._id,
        title: displayVehicleNumber(v.number),
        sub: [t(v.ownership === "own" ? "veh.own" : "veh.external"), v.driverName]
          .filter(Boolean)
          .join(" · "),
        match: (q: string) => v.number.includes(normalizeVehicleNumber(q)),
      }));
  }, [godownId, t]);
  return (
    <div className="flex flex-col gap-1">
      <EntityPicker
        label={t("veh.vehicle")}
        value={value}
        items={items}
        onSelect={onChange}
        testId={testId}
        allowClear
        renderCreate={(initial, done, cancel) => (
          <VehicleForm godownId={godownId} initial={initial} onDone={done} onCancel={cancel} />
        )}
      />
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
    </div>
  );
}
