import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { errorText, nativeCall } from "@/lib/player";

export interface AccountProfile { userId: number; nickname: string; avatarUrl: string }
const AccountContext = createContext<{
  profile: AccountProfile | null; loading: boolean; error?: string;
  setProfile: (profile: AccountProfile | null) => void;
} | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [profile, updateProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(isTauri());
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const setProfile = useCallback((value: AccountProfile | null) => {
    generation.current++; updateProfile(value); setLoading(false); setError(undefined);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    const serial = ++generation.current;
    void nativeCall<AccountProfile | null>("account_profile").then((value) => {
      if (generation.current === serial) updateProfile(value);
    }).catch((cause) => { if (generation.current === serial) setError(errorText(cause)); })
      .finally(() => { if (generation.current === serial) setLoading(false); });
    return () => { generation.current++; };
  }, []);
  return <AccountContext.Provider value={{ profile, loading, error, setProfile }}>{children}</AccountContext.Provider>;
}
export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error("AccountProvider is required");
  return value;
}
