import type { Metadata } from "next";

const SITE_NAME = "MacroLens Malaysia";
const SITE_ORIGIN = "https://macrolens-malaysia.vercel.app";

const pageDetails: Record<string, { title: string; description: string }> = {
  "/": { title: "Malaysia economy snapshot", description: "Track Malaysia’s latest prices, jobs, policy rates, trade, growth and financial-market indicators with sources and release dates." },
  "/brief": { title: "Latest economic brief", description: "A concise, data-linked briefing on what changed in Malaysia’s economy, possible explanations and what to watch." },
  "/news": { title: "Malaysia economy news", description: "Browse recent Malaysia economic headlines by topic and publisher, with dates and links to original coverage." },
  "/risk": { title: "Malaysia macro risk heatmap", description: "Inspect rule-based pressure scores, their evidence and limitations across Malaysia’s economic indicators." },
  "/forecast": { title: "Malaysia inflation forecast", description: "Review a three-month statistical forecast for Malaysian headline inflation, prediction intervals and rolling backtests." },
  "/drivers": { title: "Malaysia inflation drivers", description: "Explore CPI category movements and the factors associated with changes in Malaysian inflation." },
  "/structure": { title: "Malaysia growth drivers", description: "Compare Malaysia’s production-side and expenditure-side GDP across years and economic sectors." },
  "/external": { title: "Malaysia external sector", description: "Explore Malaysia’s exports, imports, trade balance and exchange-rate context using sourced data." },
  "/bop": { title: "Malaysia balance of payments", description: "Review Malaysia’s current, capital and financial accounts with periods, sources and interpretation notes." },
  "/household": { title: "Malaysia household pressure", description: "Compare household income, expenditure and economic pressures using published Malaysian indicators." },
  "/regional": { title: "Malaysia regional economy", description: "Compare state and district income, spending, labour, poverty and GDP where comparable official data exists." },
  "/decisions": { title: "Economic decision guide", description: "Explore conditional household and company considerations based on Malaysia’s current economic indicators." },
  "/sectors": { title: "Malaysia industry mix", description: "Review the size, growth and external sensitivities of Malaysia’s main economic sectors." },
  "/bursa": { title: "Bursa Malaysia market overview", description: "Explore the FBM KLCI’s recent performance with clear delayed-data labels and market limitations." },
  "/timeline": { title: "Malaysia economic timeline", description: "Place major Malaysian economic events alongside the indicators and periods they may help contextualise." },
  "/structural": { title: "Malaysia structural shifts", description: "Inspect exploratory break-date, stability and regime-comparison diagnostics for key economic indicators." },
  "/report": { title: "Malaysia economic data report", description: "Access MacroLens Malaysia’s generated report and machine-readable research downloads." },
  "/health": { title: "Malaysia data health", description: "Check source retrieval status, observation periods, validation notes and dashboard data freshness." },
  "/methodology": { title: "MacroLens methodology", description: "Read the dashboard’s data definitions, statistical methods, validation rules and limitations." },
};

export function routeMetadata(path: string): Metadata {
  const details = pageDetails[path];
  if (!details) throw new Error(`No public metadata is defined for route: ${path}`);

  return {
    title: `${details.title} | ${SITE_NAME}`,
    description: details.description,
    alternates: { canonical: path },
    openGraph: {
      title: `${details.title} | ${SITE_NAME}`,
      description: details.description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      images: [{ url: "/og.png", width: 1729, height: 910, alt: "MacroLens Malaysia economy and markets dashboard" }],
    },
    twitter: { card: "summary_large_image", title: `${details.title} | ${SITE_NAME}`, description: details.description, images: ["/og.png"] },
    metadataBase: new URL(SITE_ORIGIN),
  };
}
