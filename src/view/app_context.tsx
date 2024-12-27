import * as t from '../lib/types.js';
import React, { createContext, useContext, useMemo } from 'react';
import _ from 'lodash';

export type AppContextValue = {
  cache: t.CacheUIState;
};

export const AppContext = createContext<AppContextValue>({
  cache: { avatarsPath: '', coversPath: '', version: 0 },
});

export function AppContextProvider(props: { store: t.Store; children: React.ReactNode }) {
  const { cache } = props.store;
  const contextValue = useMemo<AppContextValue>(() => ({ cache }), [..._.values(cache)]);

  return <AppContext.Provider value={contextValue}>{props.children}</AppContext.Provider>;
}

export function userAppContext(): AppContextValue {
  return useContext(AppContext);
}
