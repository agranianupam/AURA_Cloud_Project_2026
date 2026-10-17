
export const ASSUMPTIONS = {
  carKgPerKm: 0.17,
  treeKgPerYear: 21,
  homeKwhPerDay: { india: 3.3, uk: 8.0 },
};

export const SOURCES = [
  `Car: ${ASSUMPTIONS.carKgPerKm} kg CO₂ per km (typical average passenger car).`,
  `Tree: ${ASSUMPTIONS.treeKgPerYear} kg CO₂ absorbed per tree per year (commonly quoted average).`,
  `Home: an average Indian home uses about ${ASSUMPTIONS.homeKwhPerDay.india} kWh/day (~100 kWh/month); an average UK home about ${ASSUMPTIONS.homeKwhPerDay.uk} kWh/day (~2,900 kWh/year).`,
];

const nf = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100).toLocaleString();

export function equivalentsFor(summary) {
  const kwh = Math.max(0, Number(summary?.energySavedKwh) || 0);
  const kg = Math.max(0, Number(summary?.co2SavedKg) || 0);
  const treeYears = kg / ASSUMPTIONS.treeKgPerYear;
  return [
    {
      key: 'car',
      label: 'Car driving avoided',
      value: `${nf(kg / ASSUMPTIONS.carKgPerKm)} km`,
      detail: `${nf(kg)} kg CO₂ ÷ ${ASSUMPTIONS.carKgPerKm} kg/km`,
    },
    {
      key: 'tree',
      label: 'Tree absorption',
      value: treeYears >= 1 ? `${nf(treeYears)} tree-years` : `${nf(treeYears * 365)} tree-days`,
      detail: `${nf(kg)} kg CO₂ ÷ ${ASSUMPTIONS.treeKgPerYear} kg per tree per year`,
    },
    {
      key: 'india',
      label: 'Indian home electricity',
      value: `${nf(kwh / ASSUMPTIONS.homeKwhPerDay.india)} home-days`,
      detail: `${nf(kwh)} kWh ÷ ${ASSUMPTIONS.homeKwhPerDay.india} kWh/day`,
    },
    {
      key: 'uk',
      label: 'UK home electricity',
      value: `${nf(kwh / ASSUMPTIONS.homeKwhPerDay.uk)} home-days`,
      detail: `${nf(kwh)} kWh ÷ ${ASSUMPTIONS.homeKwhPerDay.uk} kWh/day`,
    },
  ];
}

export function uncertaintyHint(result) {
  const mape = Number(result?.model?.testMapePct);
  if (!isFinite(mape) || mape <= 0) {
    return { text: 'These are simulated estimates. The demand forecast has typical error, so treat the figures as approximate.' };
  }
  const f = mape / 100;
  const s = result.summary || {};
  const range = (v) => (isFinite(v) ? [v * (1 - f), v * (1 + f)] : null);
  return {
    mape,
    energy: range(s.energySavedKwh),
    co2: range(s.co2SavedKg),
    text: `The demand forecast was off by about ${mape}% on average on held-out data (MAPE). If your real demand differs by a similar amount, the savings could differ by a similar proportion. Read the figures as roughly "${nf(s.energySavedKwh * (1 - f))} to ${nf(s.energySavedKwh * (1 + f))} kWh", not as exact values. This is an illustration, not a statistical confidence interval.`,
  };
}

export const fmtNum = nf;

