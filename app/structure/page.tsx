import DashboardShell from "@/app/components/DashboardShell";
import StructureView from "@/app/views/StructureView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/structure");

export default function StructurePage() { return <DashboardShell section="structure"><StructureView /></DashboardShell>; }
