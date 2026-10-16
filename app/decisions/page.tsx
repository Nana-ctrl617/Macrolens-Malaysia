import DashboardShell from "@/app/components/DashboardShell";
import DecisionsView from "@/app/views/DecisionsView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/decisions");

export default function DecisionsPage() { return <DashboardShell section="decisions"><DecisionsView /></DashboardShell>; }
