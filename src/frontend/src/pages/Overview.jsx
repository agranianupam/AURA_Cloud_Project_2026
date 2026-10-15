import React from 'react';
import SavingsKPIs from '../components/SavingsKPIs';
import ComparisonChart from '../components/ComparisonChart';
import ForecastChart from '../components/ForecastChart';
import AlertFeed from '../components/AlertFeed';
import Section, { PageHeader } from '../components/Section';

export default function Overview() {
  return (
    <>
      <PageHeader title="AURA Command Center" subtitle="Campus energy, carbon and cloud capacity at a glance" />
      <Section about="Headline results since AURA started: energy and carbon avoided versus a no-optimisation baseline, money saved, and how often service targets were met.">
        <SavingsKPIs />
      </Section>
      <Section about="Compares AURA's planned energy or carbon with what the campus would have used without it. Values are model estimates, not meter readings.">
        <ComparisonChart />
      </Section>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section className="lg:col-span-2" about="The ML model's prediction of campus demand for the next 24 hours; AURA sizes capacity from this.">
          <ForecastChart />
        </Section>
        <Section about="Latest automatic actions and warnings raised by AURA.">
          <AlertFeed />
        </Section>
      </div>
    </>
  );
}
