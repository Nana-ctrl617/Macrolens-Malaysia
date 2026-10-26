"use client";

import { type InputHealth } from "@/app/lib/dashboard";
import { healthStatusLabel } from "@/app/lib/dashboard-format";

export function InputHealthNotice({ health, dashboardStatus }: { health?: InputHealth; dashboardStatus?: InputHealth["status"] }) {
  if (!health) return null;
  return <aside className={`input-health-notice ${health.status}`} aria-label="Analysis input freshness">
    <p><strong>{healthStatusLabel(health.status)}.</strong> {health.note}</p>
    {dashboardStatus && dashboardStatus !== health.status && <p className="input-health-scope">This status applies only to this section’s inputs. Other dashboard data can have a different status.</p>}
    <a href="/health">Inspect source freshness →</a>
  </aside>;
}


export default InputHealthNotice;
