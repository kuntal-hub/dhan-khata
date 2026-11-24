/**
 * The owner's business (requirement_v2 §2.1): one per deployment. Created together with the
 * owner account (registration or the seed script); its profile (name, address, mobile, logo,
 * mon size, deductions switch) is used on receipts, invoices and reports.
 */
import type { Db } from "mongodb";
import { v7 as uuidv7 } from "uuid";
import { DEFAULT_MON_KG } from "@/domain/units";
import type { Business } from "@/domain/schemas";
import { logChanges } from "./changelog";
import { cols, getMongoClient, type UserDoc } from "./db";
import { createUser } from "./users";

export interface NewBusinessInput {
  ownerName: string;
  mobile: string;
  password: string;
  businessName: string;
  businessAddress?: string;
  recoveryCodeHash?: string;
  language?: "bn" | "en";
}

export async function createBusinessWithOwner(
  db: Db,
  input: NewBusinessInput,
): Promise<{ business: Business; owner: UserDoc }> {
  const now = new Date().toISOString();
  const businessId = uuidv7();
  const owner = await createUser(db, {
    businessId,
    name: input.ownerName,
    phone: input.mobile,
    password: input.password,
    isOwner: true,
    ...(input.language ? { language: input.language } : {}),
    ...(input.recoveryCodeHash ? { recoveryCodeHash: input.recoveryCodeHash } : {}),
  });
  const business: Business = {
    _id: businessId,
    name: input.businessName.trim(),
    ...(input.businessAddress?.trim() ? { address: input.businessAddress.trim() } : {}),
    mobile: owner.phone,
    ownerUserId: owner._id,
    monKg: DEFAULT_MON_KG,
    settings: { deductionsEnabled: false },
    rev: 1,
    createdAt: now,
    updatedAt: now,
  };
  const client = await getMongoClient();
  await client.withSession((session) =>
    session.withTransaction(async () => {
      const [seq] = await logChanges(db, session, [
        { godownId: null, entity: "business", entityId: businessId, rev: 1 },
      ]);
      await cols(db).businesses.insertOne({ ...business, serverSeq: seq! }, { session });
    }),
  );
  return { business, owner };
}

export async function getBusiness(db: Db, businessId: string): Promise<Business | null> {
  return cols(db).businesses.findOne({ _id: businessId });
}
