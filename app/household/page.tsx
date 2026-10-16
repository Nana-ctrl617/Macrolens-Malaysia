import DashboardShell from "@/app/components/DashboardShell";
import HouseholdView from "@/app/views/HouseholdView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/household");

export default function HouseholdPage() { return <DashboardShell section="household"><HouseholdView /></DashboardShell>; }
