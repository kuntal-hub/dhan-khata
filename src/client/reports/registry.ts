/** Every report (spec §9.14): per-godown builders + the owner/consolidated ones. */
import { allGodownsCash, allGodownsStock, godownComparison } from "../queries/consolidated/reports";
import { REPORTS, type ReportDef } from "./defs";

export const ALL_REPORTS: ReportDef[] = [
  ...REPORTS,
  {
    id: "comparison",
    title: "reports.name.comparison",
    group: "all",
    consolidated: true,
    build: godownComparison,
  },
  {
    id: "allStock",
    title: "reports.name.allStock",
    group: "all",
    consolidated: true,
    asOf: true,
    build: allGodownsStock,
  },
  {
    id: "allCash",
    title: "reports.name.allCash",
    group: "all",
    consolidated: true,
    asOf: true,
    build: allGodownsCash,
  },
];

export function reportById(id: string | undefined): ReportDef | undefined {
  return ALL_REPORTS.find((r) => r.id === id);
}
