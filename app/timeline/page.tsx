import DashboardShell from "@/app/components/DashboardShell";
import TimelineView from "@/app/views/TimelineView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/timeline");

export default function TimelinePage() { return <DashboardShell section="timeline"><TimelineView /></DashboardShell>; }
