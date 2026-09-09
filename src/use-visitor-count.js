import { useEffect, useState } from "react";

export function useVisitorCount() {
  const [count, setCount] = useState(null);

  useEffect(() => {
    let disposed = false;
    let controller = null;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();

      try {
        const response = await fetch("/api/visitor-count", {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("visitor_count_unavailable");

        const payload = await response.json();
        if (!Number.isSafeInteger(payload?.count) || payload.count < 0) {
          throw new Error("visitor_count_invalid");
        }
        if (!disposed) setCount(payload.count);
      } catch {
        // The counter is supplemental; transient Cloudflare/D1 failures never
        // alter the portfolio experience or replace a previously read value.
      } finally {
        controller = null;
      }
    };

    void load();

    return () => {
      disposed = true;
      controller?.abort();
    };
  }, []);

  return count;
}
