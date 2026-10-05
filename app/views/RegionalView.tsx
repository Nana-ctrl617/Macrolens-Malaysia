"use client";

import RegionalLensView from "@/app/components/RegionalLensView";
import { useDashboardData } from "@/app/components/DashboardShell";

export default function RegionalView() { const { dashboard, loading, loadHistory } = useDashboardData("regional"); const ref = dashboard?.deferred["regional-districts"]; return <RegionalLensView dashboard={dashboard} loading={loading} loadDistricts={ref ? async () => (await loadHistory(ref)).data : undefined} />; }
