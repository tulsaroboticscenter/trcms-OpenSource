import { useEffect, useState } from "react";
import { api } from "../../core/api";

/**
 * Enabled manual (admin-recorded) payment method labels, from Admin → Payment
 * Settings. Used for the enrollment "record a payment" dropdown. Falls back to
 * a sensible default if the request fails.
 */
export function useManualMethods(): string[] {
  const [methods, setMethods] = useState<string[]>(["Cash", "Check", "Scholarship"]);
  useEffect(() => {
    api.get("/api/v1/payments/manual-methods")
      .then((r) => {
        const list = (r.data as { label: string }[]).map((m) => m.label).filter(Boolean);
        if (list.length) setMethods(list);
      })
      .catch(() => {});
  }, []);
  return methods;
}
