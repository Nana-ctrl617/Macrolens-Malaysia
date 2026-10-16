import DashboardShell from "@/app/components/DashboardShell";
import SnapshotView from "@/app/views/SnapshotView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/");

export default function Home() { return <DashboardShell section="snapshot"><SnapshotView /></DashboardShell>; }
