import DashboardShell from "@/app/components/DashboardShell";
import BursaView from "@/app/views/BursaView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/bursa");

export default function BursaPage() { return <DashboardShell section="bursa"><BursaView /></DashboardShell>; }
