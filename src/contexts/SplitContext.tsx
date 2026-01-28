/**
 * SplitContext
 *
 * Provides split layout state to components without prop drilling.
 * This prevents MainPane from re-rendering when App re-renders due
 * to unrelated state changes (terminal events, PTY output, etc.).
 */

import { createContext, useContext, ReactNode } from 'react';
import { useSplitLayout, UseSplitLayoutReturn } from '../hooks/useSplitLayout';

const SplitContext = createContext<UseSplitLayoutReturn | null>(null);

export function SplitProvider({ children }: { children: ReactNode }) {
  const splitLayout = useSplitLayout();
  return (
    <SplitContext.Provider value={splitLayout}>
      {children}
    </SplitContext.Provider>
  );
}

export function useSplit(): UseSplitLayoutReturn {
  const context = useContext(SplitContext);
  if (!context) {
    throw new Error('useSplit must be used within a SplitProvider');
  }
  return context;
}
