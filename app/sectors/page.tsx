import DashboardShell from "@/app/components/DashboardShell";
import SectorsView from "@/app/views/SectorsView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/sectors");

export default function SectorsPage() { return <DashboardShell section="sectors"><SectorsView /></DashboardShell>; }
