/**
 * Redux Toolkit slices — UI/session state ONLY. Business data lives in Dexie (Phase 2),
 * never copied into Redux (spec §4).
 */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { DigitStyle } from "@/domain/digits";
import type { Lang } from "@/i18n/translate";
import type { WeightDisplay } from "@/i18n/format";

export interface SessionState {
  userId: string | null;
  userName: string | null;
  isOwner: boolean;
  /** "locked" = PIN required (offline unlock), "anonymous" = not logged in. */
  status: "anonymous" | "locked" | "active";
}

const sessionInitial: SessionState = {
  userId: null,
  userName: null,
  isOwner: false,
  status: "anonymous",
};

export const sessionSlice = createSlice({
  name: "session",
  initialState: sessionInitial,
  reducers: {
    signedIn(state, action: PayloadAction<{ userId: string; userName: string; isOwner: boolean }>) {
      state.userId = action.payload.userId;
      state.userName = action.payload.userName;
      state.isOwner = action.payload.isOwner;
      state.status = "active";
    },
    locked(state) {
      state.status = "locked";
    },
    signedOut() {
      return sessionInitial;
    },
  },
});

export interface ActiveGodownState {
  /** null = no godown yet; "ALL" = owner's read-only consolidated mode. */
  godownId: string | null;
  consolidated: boolean;
}

export const activeGodownSlice = createSlice({
  name: "activeGodown",
  initialState: { godownId: null, consolidated: false } as ActiveGodownState,
  reducers: {
    godownSelected(state, action: PayloadAction<string>) {
      state.godownId = action.payload;
      state.consolidated = false;
    },
    consolidatedSelected(state) {
      state.consolidated = true;
    },
  },
});

export interface LocaleState {
  lang: Lang;
  digits: DigitStyle;
  weight: WeightDisplay;
  /** true once the persisted preference has been loaded on this device. */
  hydrated: boolean;
}

export const localeSlice = createSlice({
  name: "locale",
  initialState: { lang: "bn", digits: "bn", weight: "qtlKg", hydrated: false } as LocaleState,
  reducers: {
    languageChanged(state, action: PayloadAction<Lang>) {
      state.lang = action.payload;
    },
    digitsChanged(state, action: PayloadAction<DigitStyle>) {
      state.digits = action.payload;
    },
    weightDisplayChanged(state, action: PayloadAction<WeightDisplay>) {
      state.weight = action.payload;
    },
    localeHydrated(state, action: PayloadAction<Partial<Omit<LocaleState, "hydrated">>>) {
      Object.assign(state, action.payload);
      state.hydrated = true;
    },
  },
});

export interface SyncState {
  online: boolean;
  pendingOps: number;
  errorOps: number;
  lastSyncAt: string | null;
  running: boolean;
}

export const syncSlice = createSlice({
  name: "sync",
  initialState: {
    online: false,
    pendingOps: 0,
    errorOps: 0,
    lastSyncAt: null,
    running: false,
  } as SyncState,
  reducers: {
    syncStatusChanged(state, action: PayloadAction<Partial<SyncState>>) {
      Object.assign(state, action.payload);
    },
  },
});

export interface UiState {
  /** Number of forms with unsaved changes (guards godown switch / SW update). */
  dirtyForms: number;
  showProfit: boolean;
}

export const uiSlice = createSlice({
  name: "ui",
  initialState: { dirtyForms: 0, showProfit: false } as UiState,
  reducers: {
    formDirtied(state) {
      state.dirtyForms += 1;
    },
    formCleaned(state) {
      state.dirtyForms = Math.max(0, state.dirtyForms - 1);
    },
    profitToggled(state) {
      state.showProfit = !state.showProfit;
    },
  },
});
