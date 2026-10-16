import DashboardShell from "@/app/components/DashboardShell";
import ForecastView from "@/app/views/ForecastView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/forecast");

export default function ForecastPage() { return <DashboardShell section="forecast"><ForecastView /></DashboardShell>; }
