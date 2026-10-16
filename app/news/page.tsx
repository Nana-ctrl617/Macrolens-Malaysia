import DashboardShell from "@/app/components/DashboardShell";
import NewsView from "@/app/views/NewsView";
import { routeMetadata } from "@/app/lib/route-metadata";

export const metadata = routeMetadata("/news");

export default function NewsPage() { return <DashboardShell section="news"><NewsView /></DashboardShell>; }
