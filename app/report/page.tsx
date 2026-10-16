import DashboardShell from "@/app/components/DashboardShell";
import ReportView from "@/app/views/ReportView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/report");

export default function ReportPage() { return <DashboardShell section="report"><ReportView /></DashboardShell>; }
