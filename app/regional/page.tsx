import DashboardShell from "@/app/components/DashboardShell";
import RegionalView from "@/app/views/RegionalView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/regional");

export default function RegionalPage() { return <DashboardShell section="regional"><RegionalView /></DashboardShell>; }
