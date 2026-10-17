import React from 'react';
import ComparisonChart from '../components/ComparisonChart';
import EnergyChart from '../components/EnergyChart';
import SavingsKPIs from '../components/SavingsKPIs';
import Section, { PageHeader } from '../components/Section';

export default function CarbonEnergy() {
  return (
    <>
      <PageHeader title="Carbon and Energy" subtitle="How much energy is used, and how clean it is" />
      <Section about="Totals of energy, carbon and cost avoided compared with the baseline, plus SLA compliance (share of time service targets were met).">
        <SavingsKPIs />
      </Section>
      <Section about="Toggle between energy (kWh) and emissions (gCO2). The green area is grid carbon intensity: when it is high, AURA tries to defer flexible work to cleaner hours.">
        <ComparisonChart />
      </Section>
      <Section about="Energy used by the campus workload under AURA over time.">
        <EnergyChart />
      </Section>
    </>
  );
}

