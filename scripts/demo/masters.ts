/**
 * Demo master data (all fictional people, firms and numbers), written through `upsertMaster`
 * exactly as the app's forms do.
 */
import { db } from "@/client/db/dexie";
import { upsertMaster } from "@/client/repo";
import type { PartyRole } from "@/domain/schemas";
import { R, kg, rate } from "./helpers";

export interface PartySpec {
  key: string;
  name: string;
  nameAlt: string;
  roles: PartyRole[];
  phone?: string;
  village?: string;
  block?: string;
  district?: string;
  millName?: string;
  gstin?: string;
  rateRs?: number;
  bank?: { holder: string; bank: string; last4: string; ifsc: string; upiId?: string };
  notes?: string;
}

export interface BankSpec {
  key: string;
  name: string;
  bank: string;
  last4: string;
  ifsc: string;
  upi: boolean;
  openingRs: number;
}

export interface VehicleSpec {
  key: string;
  number: string;
  ownership: "own" | "external";
  type: "truck" | "tractor" | "pickup" | "other";
  capacityKg: number;
  ownerKey?: string;
  driverKey?: string;
}

export interface MasterSpec {
  parties: PartySpec[];
  banks: BankSpec[];
  vehicles: VehicleSpec[];
  places: string[];
  customCategory?: string;
  customVariety?: { name: string; nameAlt: string };
  /** default deductions saved on a seeded variety (key → rupees-free grams). */
  varietyDefaults: Record<string, { tareG: number; dhaltaG: number; moistBps?: number }>;
}

export interface Book {
  gid: string;
  code: string;
  name: string;
  party: Record<string, string>;
  variety: Record<string, string>;
  bank: Record<string, string>;
  vehicle: Record<string, string>;
  place: Record<string, string>;
  /** Custom expense category code (user-created). */
  customCategory?: string;
}

export async function createMasters(gid: string, code: string, name: string, spec: MasterSpec) {
  const book: Book = { gid, code, name, party: {}, variety: {}, bank: {}, vehicle: {}, place: {} };

  // Seeded varieties exist already (created with the godown); give a few their own defaults.
  const varieties = await db().varieties.where("godownId").equals(gid).toArray();
  for (const v of varieties) {
    if (!v.systemKey) continue;
    book.variety[v.systemKey] = v._id;
    const d = spec.varietyDefaults[v.systemKey];
    if (d) {
      await upsertMaster(gid, "variety", {
        _id: v._id,
        name: v.name,
        systemKey: v.systemKey,
        defaultDeductions: {
          tarePerBagG: String(d.tareG),
          dhaltaMode: "PER_QUINTAL",
          dhaltaValueG: String(d.dhaltaG),
          ...(d.moistBps !== undefined ? { moistureBps: d.moistBps } : {}),
        },
      });
    }
  }
  if (spec.customVariety) {
    const v = await upsertMaster(gid, "variety", {
      name: spec.customVariety.name,
      nameAlt: spec.customVariety.nameAlt,
      renamed: true,
      defaultDeductions: { tarePerBagG: "500", dhaltaMode: "PER_QUINTAL", dhaltaValueG: "1000" },
    });
    book.variety.CUSTOM = v._id;
  }

  for (const p of spec.parties) {
    const doc = await upsertMaster(gid, "party", {
      name: p.name,
      nameAlt: p.nameAlt,
      roles: p.roles,
      ...(p.phone ? { phone: p.phone } : {}),
      ...(p.village ? { village: p.village } : {}),
      ...(p.block ? { block: p.block } : {}),
      ...(p.district ? { district: p.district } : {}),
      ...(p.millName ? { millName: p.millName } : {}),
      ...(p.gstin ? { gstin: p.gstin } : {}),
      ...(p.rateRs
        ? {
            defaultRatePaisePerQtl: rate(p.rateRs),
            defaultDeductions: { tarePerBagG: "500", dhaltaMode: "PER_QUINTAL", dhaltaValueG: "1000" },
          }
        : {}),
      ...(p.bank
        ? {
            bankDetails: {
              holder: p.bank.holder,
              bank: p.bank.bank,
              accountLast4: p.bank.last4,
              ifsc: p.bank.ifsc,
              ...(p.bank.upiId ? { upiId: p.bank.upiId } : {}),
            },
          }
        : {}),
      ...(p.notes ? { notes: p.notes } : {}),
    });
    book.party[p.key] = doc._id;
  }

  for (const b of spec.banks) {
    const doc = await upsertMaster(gid, "bankAccount", {
      name: b.name,
      bank: b.bank,
      last4: b.last4,
      ifsc: b.ifsc,
      isUpiLinked: b.upi,
      openingBalancePaise: R(b.openingRs),
    });
    book.bank[b.key] = doc._id;
  }

  for (const v of spec.vehicles) {
    const doc = await upsertMaster(gid, "vehicle", {
      number: v.number,
      ownership: v.ownership,
      type: v.type,
      capacityG: kg(v.capacityKg),
      ...(v.ownerKey ? { ownerPartyId: book.party[v.ownerKey]! } : {}),
      ...(v.driverKey ? { driverPartyId: book.party[v.driverKey]! } : {}),
    });
    book.vehicle[v.key] = doc._id;
  }

  for (const [i, name] of spec.places.entries()) {
    const doc = await upsertMaster(gid, "place", { name });
    book.place[`P${i + 1}`] = doc._id;
  }

  if (spec.customCategory) {
    const doc = await upsertMaster(gid, "expenseCategory", {
      isSystem: false,
      enabled: true,
      name: spec.customCategory,
    } as never);
    book.customCategory = (doc as { code: string }).code;
  }
  return book;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rampur Godown (the main business)
// ─────────────────────────────────────────────────────────────────────────────

export const RAMPUR: MasterSpec = {
  varietyDefaults: {
    SWARNA: { tareG: 500, dhaltaG: 1000 },
    MINIKIT: { tareG: 500, dhaltaG: 1000 },
    LAL_SWARNA: { tareG: 500, dhaltaG: 1000, moistBps: 100 },
    GOBINDOBHOG: { tareG: 500, dhaltaG: 500 },
  },
  customVariety: { name: "সাবিত্রী", nameAlt: "Sabitri" },
  customCategory: "ত্রিপল ভাড়া",
  places: ["সাঁইথিয়া মান্ডি", "বোলপুর বাজার", "নলহাটি হাট", "মেমারি মান্ডি"],
  banks: [
    {
      key: "sbi",
      name: "SBI চলতি হিসাব",
      bank: "State Bank of India",
      last4: "4521",
      ifsc: "SBIN0001234",
      upi: false,
      openingRs: 320_000,
    },
    {
      key: "uco",
      name: "UCO সেভিংস (UPI)",
      bank: "UCO Bank",
      last4: "7788",
      ifsc: "UCBA0002345",
      upi: true,
      openingRs: 85_000,
    },
  ],
  vehicles: [
    {
      key: "own1",
      number: "WB44A1234",
      ownership: "own",
      type: "truck",
      capacityKg: 18_000,
      driverKey: "d1",
    },
    {
      key: "own2",
      number: "WB44B5678",
      ownership: "own",
      type: "pickup",
      capacityKg: 3_000,
      driverKey: "d2",
    },
    {
      key: "ext1",
      number: "WB52C9012",
      ownership: "external",
      type: "truck",
      capacityKg: 20_000,
      ownerKey: "tr1",
    },
  ],
  parties: [
    { key: "f1", name: "রমেশ মণ্ডল", nameAlt: "Ramesh Mondal", roles: ["farmer"], phone: "9832100101", village: "মল্লারপুর", district: "বীরভূম", rateRs: 2280 },
    { key: "f2", name: "সুকুমার দাস", nameAlt: "Sukumar Das", roles: ["farmer"], phone: "9832100102", village: "নলহাটি", district: "বীরভূম", rateRs: 2350 },
    { key: "f3", name: "গোপাল হেমব্রম", nameAlt: "Gopal Hembram", roles: ["farmer"], phone: "9832100103", village: "লাভপুর", district: "বীরভূম" },
    { key: "f4", name: "আব্দুল রহিম শেখ", nameAlt: "Abdul Rahim Sheikh", roles: ["farmer"], phone: "9832100104", village: "ইলামবাজার", district: "বীরভূম", bank: { holder: "Abdul Rahim Sheikh", bank: "SBI", last4: "3306", ifsc: "SBIN0004455", upiId: "rahim.sheikh@oksbi" } },
    { key: "f5", name: "বিশ্বনাথ ঘোষ", nameAlt: "Biswanath Ghosh", roles: ["farmer"], phone: "9832100105", village: "মেমারি", district: "পূর্ব বর্ধমান" },
    { key: "f6", name: "কার্তিক বাউরি", nameAlt: "Kartik Bauri", roles: ["farmer"], phone: "9832100106", village: "আউসগ্রাম", district: "পূর্ব বর্ধমান" },
    { key: "f7", name: "হরিপদ সরকার", nameAlt: "Haripada Sarkar", roles: ["farmer"], phone: "9832100107", village: "গলসী", district: "পূর্ব বর্ধমান" },
    { key: "f8", name: "মহম্মদ সেলিম মল্লিক", nameAlt: "Mohammad Salim Mallick", roles: ["farmer"], phone: "9832100108", village: "কাটোয়া", district: "পূর্ব বর্ধমান" },
    { key: "t1", name: "সেন অ্যান্ড সন্স ট্রেডার্স", nameAlt: "Sen & Sons Traders", roles: ["party"], phone: "9832200201", village: "বোলপুর", district: "বীরভূম", gstin: "19AABCS1234F1Z5" },
    { key: "t2", name: "রায় ব্রাদার্স", nameAlt: "Roy Brothers", roles: ["party"], phone: "9832200202", village: "দুর্গাপুর", district: "পশ্চিম বর্ধমান", gstin: "19AAEFR5678K1Z2" },
    { key: "m1", name: "মা তারা রাইস মিল", nameAlt: "Maa Tara Rice Mill", roles: ["mill"], phone: "9832300301", village: "বোলপুর", district: "বীরভূম", millName: "Maa Tara Rice Mill Pvt. Ltd.", gstin: "19AAKCM2345P1ZQ", bank: { holder: "Maa Tara Rice Mill", bank: "HDFC Bank", last4: "8812", ifsc: "HDFC0001122" } },
    { key: "m2", name: "অন্নপূর্ণা এগ্রো ইন্ডাস্ট্রিজ", nameAlt: "Annapurna Agro Industries", roles: ["mill"], phone: "9832300302", village: "বর্ধমান", district: "পূর্ব বর্ধমান", millName: "Annapurna Agro Industries", gstin: "19AAFCA9876L1Z8", bank: { holder: "Annapurna Agro Industries", bank: "ICICI Bank", last4: "5590", ifsc: "ICIC0003344" } },
    { key: "m3", name: "শ্রী গণেশ রাইস মিল", nameAlt: "Shree Ganesh Rice Mill", roles: ["mill"], phone: "9832300303", village: "দুর্গাপুর", district: "পশ্চিম বর্ধমান", millName: "Shree Ganesh Rice Mill", bank: { holder: "Shree Ganesh Rice Mill", bank: "Axis Bank", last4: "2271", ifsc: "UTIB0005566" } },
    { key: "tr1", name: "বেঙ্গল রোডলাইনস", nameAlt: "Bengal Roadlines", roles: ["transporter"], phone: "9832400401", village: "বোলপুর", district: "বীরভূম" },
    { key: "d1", name: "দীপক রাজক", nameAlt: "Dipak Rajak", roles: ["driver"], phone: "9832400402", village: "সিউড়ি", district: "বীরভূম" },
    { key: "d2", name: "শম্ভু মাল", nameAlt: "Sambhu Mal", roles: ["driver"], phone: "9832400403", village: "রামপুরহাট", district: "বীরভূম" },
    { key: "l1", name: "হারু বাগদি", nameAlt: "Haru Bagdi (labour sardar)", roles: ["labour"], phone: "9832500501", village: "রামপুরহাট", district: "বীরভূম", notes: "Loading/unloading labour contractor, 8 men" },
    { key: "p1", name: "ভোলানাথ ফিলিং স্টেশন", nameAlt: "Bholanath Filling Station", roles: ["pump"], phone: "9832600601", village: "রামপুরহাট", district: "বীরভূম" },
    { key: "o1", name: "হেমন্ত ইলেকট্রিক", nameAlt: "Hemanta Electric", roles: ["other"], phone: "9832600602", village: "রামপুরহাট", district: "বীরভূম" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Sonapur Godown (second, smaller business)
// ─────────────────────────────────────────────────────────────────────────────

export const SONAPUR: MasterSpec = {
  varietyDefaults: {
    SWARNA: { tareG: 500, dhaltaG: 1000 },
    MINIKIT: { tareG: 500, dhaltaG: 1000 },
  },
  places: ["সোনাপুর হাট", "কান্দি মান্ডি"],
  banks: [
    {
      key: "bob",
      name: "ব্যাংক অব বরোদা চলতি",
      bank: "Bank of Baroda",
      last4: "9012",
      ifsc: "BARB0SONAPU",
      upi: true,
      openingRs: 150_000,
    },
  ],
  vehicles: [
    { key: "own1", number: "WB57D4321", ownership: "own", type: "pickup", capacityKg: 3_500, driverKey: "d1" },
  ],
  parties: [
    { key: "s1", name: "নিতাই পাল", nameAlt: "Nitai Pal", roles: ["farmer"], phone: "9733100101", village: "সোনাপুর", district: "মুর্শিদাবাদ" },
    { key: "s2", name: "মোস্তাফা কামাল", nameAlt: "Mostafa Kamal", roles: ["farmer"], phone: "9733100102", village: "কান্দি", district: "মুর্শিদাবাদ" },
    { key: "s3", name: "অনিল বিশ্বাস", nameAlt: "Anil Biswas", roles: ["farmer"], phone: "9733100103", village: "ভরতপুর", district: "মুর্শিদাবাদ" },
    { key: "s4", name: "শেখ জাহাঙ্গীর", nameAlt: "Sk Jahangir", roles: ["farmer"], phone: "9733100104", village: "বড়ঞা", district: "মুর্শিদাবাদ" },
    { key: "sm1", name: "বিজয় রাইস মিল", nameAlt: "Bijoy Rice Mill", roles: ["mill"], phone: "9733300301", village: "বহরমপুর", district: "মুর্শিদাবাদ", millName: "Bijoy Rice Mill", bank: { holder: "Bijoy Rice Mill", bank: "PNB", last4: "6643", ifsc: "PUNB0123400" } },
    { key: "st1", name: "লক্ষ্মী ট্রেডিং কোম্পানি", nameAlt: "Laxmi Trading Co.", roles: ["party"], phone: "9733200201", village: "বহরমপুর", district: "মুর্শিদাবাদ" },
    { key: "d1", name: "রবি হালদার", nameAlt: "Rabi Halder", roles: ["driver"], phone: "9733400401", village: "সোনাপুর", district: "মুর্শিদাবাদ" },
    { key: "l1", name: "কালু শেখ", nameAlt: "Kalu Sk (labour)", roles: ["labour"], phone: "9733500501", village: "সোনাপুর", district: "মুর্শিদাবাদ" },
  ],
};
