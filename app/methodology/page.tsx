import DashboardShell from "@/app/components/DashboardShell";
import MethodologyView from "@/app/views/MethodologyView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/methodology");

export default function MethodologyPage() { return <DashboardShell section="methodology"><MethodologyView /></DashboardShell>; }
