import { useCallback, useEffect, useState } from 'react';
import { edgeBase, type EdgeSetup } from '../../shared/edge-protocol';

export function useEdgeConnection() {
  const [setup, setSetup] = useState<EdgeSetup | null>(null);
  const [checked, setChecked] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${edgeBase}/api/setup`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error('接入服务不可用');
      setSetup(await response.json());
    } catch {
      setSetup(null);
    } finally {
      setChecked(true);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);
  return { setup, checked, load };
}
