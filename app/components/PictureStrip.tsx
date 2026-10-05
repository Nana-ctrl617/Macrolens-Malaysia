"use client";



export type PictureVariant = "city" | "prices" | "trade" | "markets" | "household" | "research";

export const pictureCopy: Record<PictureVariant, { title: string; caption: string; aria: string; src: string }> = {
  city: {
    title: "Malaysia macro dashboard",
    caption: "Prices, jobs, rates and growth in one public view.",
    aria: "Illustration of Malaysia's economy with city blocks and dashboard signals",
    src: "/editorial/city.jpg",
  },
  prices: {
    title: "Inflation basket",
    caption: "Household prices, CPI categories and purchasing power.",
    aria: "Illustration of a household inflation basket with price bars",
    src: "/editorial/prices.jpg",
  },
  trade: {
    title: "External sector",
    caption: "Exports, imports, the ringgit and trade balance.",
    aria: "Illustration of port cranes, containers and exchange-rate signals",
    src: "/editorial/trade.jpg",
  },
  markets: {
    title: "Financial markets",
    caption: "Bursa, bonds, policy rates and market pressure.",
    aria: "Illustration of market charts and financial conditions",
    src: "/editorial/markets.jpg",
  },
  household: {
    title: "Decision context",
    caption: "Savings, borrowing, jobs and business planning scenarios.",
    aria: "Illustration of households and companies using economic data",
    src: "/editorial/household.jpg",
  },
  research: {
    title: "Statistical evidence",
    caption: "Forecasts, structural shifts and reproducible methodology.",
    aria: "Illustration of statistical tests, charts and research notes",
    src: "/editorial/research.jpg",
  },
};

export function EditorialPicture({ variant }: { variant: PictureVariant }) {
  const copy = pictureCopy[variant];
  return (
    <figure className={`editorial-picture ${variant}`}>
      <img className="editorial-photo" src={copy.src} alt={copy.aria} loading="lazy" />
      <div className="picture-scene" aria-hidden="true">
        <i className="shape one" />
        <i className="shape two" />
        <i className="shape three" />
        <i className="shape four" />
      </div>
      <figcaption><strong>{copy.title}</strong><span>{copy.caption}</span></figcaption>
    </figure>
  );
}

export function PictureStrip({ pictures }: { pictures: PictureVariant[] }) {
  return <div className="picture-strip">{pictures.map((picture) => <EditorialPicture key={picture} variant={picture} />)}</div>;
}


export default PictureStrip;
