import DashboardShell from "@/app/components/DashboardShell";
import DriversView from "@/app/views/DriversView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/drivers");

export default function DriversPage() { return <DashboardShell section="drivers"><DriversView /></DashboardShell>; }
