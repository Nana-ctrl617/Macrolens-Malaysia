import DashboardShell from "@/app/components/DashboardShell";
import ExternalView from "@/app/views/ExternalView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/external");

export default function ExternalPage() { return <DashboardShell section="external"><ExternalView /></DashboardShell>; }
