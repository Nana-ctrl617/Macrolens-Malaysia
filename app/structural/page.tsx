import DashboardShell from "@/app/components/DashboardShell";
import StructuralView from "@/app/views/StructuralView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/structural");

export default function StructuralPage() { return <DashboardShell section="structural"><StructuralView /></DashboardShell>; }
