import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dashboard } from '../../shared/model';
import { api } from '../lib/api';

export type Notice = { message: string; error?: boolean } | null;
export function useDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await api<Dashboard>('/dashboard');
      if (id === request.current) {
        setData(next);
        setOffline(false);
      }
    } catch {
      if (id === request.current) setOffline(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(
      () => void load(),
      data?.activeRun || data?.onboarding.active ? 1000 : 5000,
    );
    return () => clearInterval(timer);
  }, [data?.activeRun?.id, data?.onboarding.active, load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const act = useCallback(
    async (work: () => Promise<unknown>, message?: string) => {
      setBusy(true);
      try {
        await work();
        await load();
        if (message) setNotice({ message });
      } catch (error) {
        setNotice({ message: (error as Error).message, error: true });
      } finally {
        setBusy(false);
      }
    },
    [load],
  );
  return { data, offline, busy, notice, setNotice, load, act };
}
