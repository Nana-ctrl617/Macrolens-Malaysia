import DashboardShell from "@/app/components/DashboardShell";
import BopView from "@/app/views/BopView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/bop");

export default function BopPage() { return <DashboardShell section="bop"><BopView /></DashboardShell>; }
