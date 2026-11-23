/** Changelog (pull feed) + audit writers. Call inside a Mongo transaction. */
import type { ClientSession, Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { cols, nextServerSeq, type AuditDoc } from "./db";

export interface ChangeEntry {
  godownId: string | null;
  entity: string;
  entityId: string;
  rev: number;
}

/** Allocate serverSeqs and append changelog entries; returns the seq of each entry. */
export async function logChanges(
  db: Db,
  session: ClientSession,
  entries: readonly ChangeEntry[],
): Promise<number[]> {
  if (entries.length === 0) return [];
  const first = await nextServerSeq(db, session, entries.length);
  const at = new Date();
  const docs = entries.map((e, i) => ({ ...e, serverSeq: first + i, at }));
  await cols(db).changelog.insertMany(docs, { session });
  return docs.map((d) => d.serverSeq);
}

export async function audit(
  db: Db,
  session: ClientSession | undefined,
  entry: Omit<AuditDoc, "_id" | "at">,
): Promise<void> {
  await cols(db).audit.insertOne({ _id: uuidv7(), at: new Date(), ...entry }, { session });
}
