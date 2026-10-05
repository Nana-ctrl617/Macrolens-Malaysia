"use client";

import { useState } from "react";
import type { DeferredHistory, HistoryDataMap, HistoryId } from "@/app/lib/dashboard-projection";
import type { DashboardHistoryLoader } from "./DashboardShell";

export function useDeferredHistory<H extends HistoryId>(ref?: DeferredHistory<H>, loadHistory?: DashboardHistoryLoader) {
  const [records, setRecords] = useState<Record<string, HistoryDataMap[H]>>({});
  const [pending, setPending] = useState("");
  const [failure, setFailure] = useState<{ key: string; message: string }>({ key: "", message: "" });
  const key = ref ? `${ref.artifactId}:${ref.id}` : "";
  const data = records[key] ?? null;
  const loading = pending === key && Boolean(key);
  const error = failure.key === key ? failure.message : "";
  const load = async () => {
    if (data) return data;
    if (!ref || !loadHistory || loading) return null;
    setPending(key); setFailure({ key, message: "" });
    try { const result = await loadHistory(ref); setRecords(current => ({ ...current, [key]: result.data })); return result.data; }
    catch (failure) { setFailure({ key, message: failure instanceof Error ? failure.message : "History could not be loaded. Please retry." }); return null; }
    finally { setPending(current => current === key ? "" : current); }
  };
  return { data, loading, error, load };
}

export function DeferredHistoryControl({ complete, returnedRows, totalRows, loading, error, onLoad, label = "Load complete history" }: {
  complete: boolean; returnedRows: number; totalRows: number; loading: boolean; error: string; onLoad: () => void; label?: string;
}) {
  if (complete) return null;
  return <div className="dashboard-load-status" role="status" aria-live="polite" aria-atomic="true">
    <p>Recent preview: {returnedRows} of {totalRows} published records. This is not complete history.</p>
    <button type="button" onClick={onLoad} disabled={loading}>{loading ? "Loading history…" : error ? "Retry history" : label}</button>
    {error && <p>{error}</p>}
  </div>;
}
