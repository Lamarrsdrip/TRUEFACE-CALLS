"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/api";

export function useApiResource<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiFetch<T>(path));
    } catch (value) {
      setError(value instanceof Error ? value.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, error, loading, refresh };
}
