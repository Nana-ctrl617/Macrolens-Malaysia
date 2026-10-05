/** CSS tokens own chart semantics; these fallbacks keep isolated canvases readable. */
type TokenStyle = Pick<CSSStyleDeclaration, "getPropertyValue">;
const defaults: Record<string, string> = {
  "--chart-text-light": "#52636b", "--chart-grid-light": "#dfe6ea", "--chart-zero-light": "#81949e",
  "--chart-text-dark": "#d5e1db", "--chart-grid-dark": "rgba(255,255,255,.18)", "--chart-zero-dark": "#bdcbc6",
  "--chart-selection-light": "#15221f", "--chart-selection-dark": "#f2faf6",
  "--chart-break-supported": "#c73b2d", "--chart-break-possible": "#946a22", "--chart-break-unsupported": "#69736e",
  "--chart-fill-light": "rgba(199,59,45,.18)", "--chart-fill-dark": "rgba(83,196,167,.3)",
  "--text-primary": "#17252b", "--surface-panel": "#ffffff",
  "--category-1": "#d95c3f", "--category-2": "#1d746b", "--category-3": "#9a6b16",
  "--category-4": "#274653", "--category-5": "#7b6fa6", "--category-6": "#5d7564",
  "--series-headline": "#c73b2d", "--series-core": "#16665c", "--series-unemployment": "#1e3744",
  "--series-opr": "#275f91", "--series-fx": "#716092", "--series-mgs": "#8b6518",
  "--chart-market-line": "#53c4a7",
};

export function resolveChartColour(style: TokenStyle, value: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
  return token ? style.getPropertyValue(token).trim() || defaults[token] || "#17252b" : value;
}

export function chartColours(style: TokenStyle, dark = false) {
  const read = (key: string) => resolveChartColour(style, `var(${key})`);
  const suffix = dark ? "dark" : "light";
  return {
    text: read(`--chart-text-${suffix}`), grid: read(`--chart-grid-${suffix}`),
    zero: read(`--chart-zero-${suffix}`), selection: read(`--chart-selection-${suffix}`),
    fill: read(`--chart-fill-${suffix}`), primary: read("--text-primary"), surface: read("--surface-panel"),
    supported: read("--chart-break-supported"), possible: read("--chart-break-possible"), unsupported: read("--chart-break-unsupported"),
  };
}

export const sectorColourTokens = Array.from({ length: 6 }, (_, index) => `var(--category-${index + 1})`);
export const indicatorColourTokens: Record<string, string> = Object.fromEntries(
  ["headline", "core", "unemployment", "opr", "fx", "mgs"].map(key => [key, `var(--series-${key})`]),
);
