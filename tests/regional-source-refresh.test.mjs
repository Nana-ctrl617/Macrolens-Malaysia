import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateRegionalShape, validateRegionalNumbers } from '../app/lib/regional-integrity.ts';

const fixture = () => JSON.parse(readFileSync(new URL('../data/published/dashboard.json', import.meta.url), 'utf8')).regionalLens;
function localFixture() {
  const value = fixture();
  value.refreshPolicy = 'source-local-v1';
  for (const key of ['gdpState','gdpDistrict','incomeGroupState','incomeGroupNational','nationalIncome','nationalPoverty','nationalInequality','nationalExpenditure']) {
    value.sources[key] = { status: 'fresh', retrievedAt: value.generatedAt, observationPeriod: '2024-01-01', sourceUrl: 'https://data.gov.my/' };
  }
  return value;
}
const absent = { status: 'unavailable', retrievedAt: null, observationPeriod: null, sourceUrl: 'https://data.gov.my/' };

test('legacy regional coverage remains accepted without relaxing incomplete legacy data', () => {
  assert.equal(validateRegionalShape(fixture()), true);
  const value = fixture(); value.districtRecords = [];
  assert.equal(validateRegionalShape(value), false);
});
test('source-local first-run failure accepts explicit unavailable district HIES', () => {
  const value = localFixture(); value.districtRecords = []; value.sources.hiesDistrict = absent;
  assert.equal(validateRegionalShape(value), true);
  value.sources.hiesDistrict = { ...absent, status: 'fresh' };
  assert.equal(validateRegionalShape(value), false);
});
test('unavailable state HIES retains GDP/CPI geographies with null household periods and values', () => {
  const value = localFixture(); value.sources.hiesState = absent;
  for (const row of value.stateRecords) {
    for (const key of ['date','incomeMean','incomeMedian','expenditureMean','incomeMinusExpenditure','incomeToExpenditureRatio','poverty','gini']) row[key] = null;
  }
  assert.equal(validateRegionalShape(value), true);
  assert.equal(validateRegionalNumbers(value), true);
  value.stateRecords[0].incomeMedian = 0;
  assert.equal(validateRegionalNumbers(value), false, 'unavailable source cannot lend invented zeros');
});
test('missing source status, malformed non-null numbers and missing-value clocks fail closed', () => {
  const value = localFixture(); delete value.sources.gdpState;
  assert.equal(validateRegionalShape(value), false);
  const other = localFixture(); other.stateRecords[0].incomeMean = NaN;
  assert.equal(validateRegionalNumbers(other), false);
  other.stateRecords[0].incomeMean = null;
  assert.equal(validateRegionalNumbers(other), false);
});
test('unavailable sources do not acquire a fabricated retrieval date', () => {
  const value = localFixture(); value.sources.hiesDistrict = { ...absent, retrievedAt: value.generatedAt }; value.districtRecords = [];
  assert.equal(validateRegionalShape(value), false);
});
