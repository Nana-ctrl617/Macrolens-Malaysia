import DashboardShell from "@/app/components/DashboardShell";
import HealthView from "@/app/views/HealthView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/health");

export default function HealthPage() { return <DashboardShell section="health"><HealthView /></DashboardShell>; }
