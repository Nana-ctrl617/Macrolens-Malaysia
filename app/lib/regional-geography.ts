/**
 * Conservative, state-scoped reconciliation of names found in the official HIES,
 * labour and district GDP series. This is spelling/abbreviation reconciliation,
 * never a fuzzy match or a change in administrative boundary.
 *
 * Canonical administrative names checked against primary government sources:
 * Lubok Antu: https://www.dosm.gov.my/uploads/publications/20221018120139.pdf
 * Tanjung Manis: https://matu-darodc.sarawak.gov.my/web/subpage/webpage_view/118
 * Seberang Perai districts: https://www.dosm.gov.my/portal-main/release-document-log?release_document_id=16399
 * Larut dan Matang: https://www.dosm.gov.my/uploads/publications/20221018152728.pdf
 * Hulu Terengganu: https://storage.dosm.gov.my/gdp/gdp_district_2020.pdf
 * Original spellings are retained in the unchanged official source records.
 */
export type CanonicalRegionalGeography = { key: string; state: string; district: string; kind: "district" | "residual" };

const stateNames = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis", "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu", "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya"];
const stateCase = new Map(stateNames.map((state) => [state.toLowerCase(), state]));
const districtAliases: Record<string, Record<string, string>> = {
  Sarawak: {
    "lubok antu": "Lubok Antu",
    "tanjong manis": "Tanjung Manis",
    "tanjung manis": "Tanjung Manis",
  },
  "Pulau Pinang": {
    "s.p. selatan": "Seberang Perai Selatan", "s.p.selatan": "Seberang Perai Selatan", "seberang perai selatan": "Seberang Perai Selatan",
    "s.p. tengah": "Seberang Perai Tengah", "s.p.tengah": "Seberang Perai Tengah", "seberang perai tengah": "Seberang Perai Tengah",
    "s.p. utara": "Seberang Perai Utara", "s.p.utara": "Seberang Perai Utara", "seberang perai utara": "Seberang Perai Utara",
  },
  Perak: { "larut & matang": "Larut dan Matang", "larut dan matang": "Larut dan Matang" },
  Terengganu: { hulu: "Hulu Terengganu", "hulu terengganu": "Hulu Terengganu" },
};
const clean = (name: string) => name.trim().replace(/\s+/g, " ");

export function normalizeRegionalGeography(state: string, district: string): CanonicalRegionalGeography {
  const suppliedState = clean(state);
  const canonicalState = stateCase.get(suppliedState.toLowerCase()) ?? suppliedState;
  const suppliedDistrict = clean(district);
  const canonicalDistrict = districtAliases[canonicalState]?.[suppliedDistrict.toLowerCase()] ?? suppliedDistrict;
  // The official GDP metadata explicitly describes these as unattributed GDP,
  // not administrative districts. Never merge them into a real district.
  // https://data.gov.my/data-catalogue/gdp_district_real_supply
  const residual = ((canonicalState === "Sabah" || canonicalState === "Sarawak") && suppliedDistrict.toLowerCase() === "supra")
    || ["supra", "supranational"].includes(canonicalState.toLowerCase());
  return { key: `${canonicalState}|${canonicalDistrict}`, state: canonicalState, district: canonicalDistrict, kind: residual ? "residual" : "district" };
}
