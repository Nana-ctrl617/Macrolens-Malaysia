import DashboardShell from "@/app/components/DashboardShell";
import BriefView from "@/app/views/BriefView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/brief");

export default function BriefPage() { return <DashboardShell section="brief"><BriefView /></DashboardShell>; }
