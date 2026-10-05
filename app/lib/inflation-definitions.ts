

export const inflationDefinitions = {
  headline: {
    short: "The year-on-year change in Malaysia's full Consumer Price Index (CPI) basket.",
    explanation: "It includes all items in the basket, so movements in food, fuel, utilities, taxes and administered prices can affect it quickly.",
  },
  core: {
    short: "A measure of underlying price pressure after selected volatile and administered-price items are removed from the CPI basket.",
    explanation: "It helps show whether inflation is broad and persistent, but it is not a household's actual cost-of-living rate.",
  },
} as const;
