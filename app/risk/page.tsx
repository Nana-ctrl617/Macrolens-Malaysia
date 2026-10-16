import DashboardShell from "@/app/components/DashboardShell";
import RiskView from "@/app/views/RiskView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/risk");

export default function RiskPage() { return <DashboardShell section="risk"><RiskView /></DashboardShell>; }
