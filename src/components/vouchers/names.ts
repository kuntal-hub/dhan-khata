"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/client/db/dexie";
import { bankLabel, partyTitle, varietyLabel, vehicleLabel } from "@/client/ui/labels";
import { useI18n } from "@/i18n/I18nProvider";

export interface Names {
  party: (id: string | undefined) => string;
  variety: (id: string | undefined) => string;
  bank: (id: string | undefined) => string;
  place: (id: string | undefined) => string;
  vehicle: (id: string | undefined) => string;
}

/** Display names for all masters of a godown (small tables; live). */
export function useNames(godownId: string | null): Names | undefined {
  const { t, lang } = useI18n();
  const data = useLiveQuery(async () => {
    if (!godownId) return null;
    const d = db();
    const [parties, varieties, banks, places, vehicles] = await Promise.all([
      d.parties.where("godownId").equals(godownId).toArray(),
      d.varieties.where("godownId").equals(godownId).toArray(),
      d.bankAccounts.where("godownId").equals(godownId).toArray(),
      d.places.where("godownId").equals(godownId).toArray(),
      d.vehicles.where("godownId").equals(godownId).toArray(),
    ]);
    return { parties, varieties, banks, places, vehicles };
  }, [godownId]);
  if (!data) return undefined;
  const by = <T extends { _id: string }>(list: T[]) => new Map(list.map((x) => [x._id, x]));
  const parties = by(data.parties);
  const varieties = by(data.varieties);
  const banks = by(data.banks);
  const places = by(data.places);
  const vehicles = by(data.vehicles);
  return {
    party: (id) => {
      const p = id ? parties.get(id) : undefined;
      if (!p) return "";
      const { title, sub } = partyTitle(p, lang);
      return sub ? `${title} (${sub})` : title;
    },
    variety: (id) => varietyLabel(id ? varieties.get(id) : undefined, t),
    bank: (id) => bankLabel(id ? banks.get(id) : undefined),
    place: (id) => (id ? (places.get(id)?.name ?? "") : ""),
    vehicle: (id) => vehicleLabel(id ? vehicles.get(id) : undefined),
  };
}
