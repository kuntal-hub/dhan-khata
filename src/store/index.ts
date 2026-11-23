import { configureStore } from "@reduxjs/toolkit";
import { useDispatch, useSelector, useStore } from "react-redux";
import { activeGodownSlice, localeSlice, sessionSlice, syncSlice, uiSlice } from "./slices";

export function makeStore() {
  return configureStore({
    reducer: {
      session: sessionSlice.reducer,
      activeGodown: activeGodownSlice.reducer,
      locale: localeSlice.reducer,
      sync: syncSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
export const useAppStore = useStore.withTypes<AppStore>();

export const actions = {
  session: sessionSlice.actions,
  activeGodown: activeGodownSlice.actions,
  locale: localeSlice.actions,
  sync: syncSlice.actions,
  ui: uiSlice.actions,
};
