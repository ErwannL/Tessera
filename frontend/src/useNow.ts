import { useEffect, useState } from 'react';

/** Current time (ms), refreshed every `intervalMs`. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const handle = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(handle);
    };
  }, [intervalMs]);
  return now;
}
