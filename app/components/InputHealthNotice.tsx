"use client";

import { type InputHealth } from "@/app/lib/dashboard";
import { healthStatusLabel } from "@/app/lib/dashboard-format";

export function InputHealthNotice({ health }: { health?: InputHealth }) {
  if (!health) return null;
  return <aside className={`input-health-notice ${health.status}`} aria-label="Analysis input freshness">
    <p><strong>{healthStatusLabel(health.status)}.</strong> {health.note}</p>
    <a href="/health">Inspect source freshness →</a>
  </aside>;
}


export default InputHealthNotice;
