import { createContext, useContext, useState, type ReactNode } from "react";

interface HelpCtx {
  open: boolean;
  helpKey?: string;
  openHelp: (key?: string) => void;
  closeHelp: () => void;
}

const Ctx = createContext<HelpCtx>({ open: false, openHelp: () => {}, closeHelp: () => {} });

export const useHelp = () => useContext(Ctx);

export function HelpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [helpKey, setHelpKey] = useState<string | undefined>(undefined);
  return (
    <Ctx.Provider value={{ open, helpKey, openHelp: (k) => { setHelpKey(k); setOpen(true); }, closeHelp: () => setOpen(false) }}>
      {children}
    </Ctx.Provider>
  );
}
