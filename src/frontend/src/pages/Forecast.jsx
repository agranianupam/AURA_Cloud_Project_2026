import React from 'react';
import ForecastChart from '../components/ForecastChart';
import Section, { PageHeader } from '../components/Section';

export default function Forecast() {
  return (
    <>
      <PageHeader title="Demand Forecast" subtitle="What the model expects the campus to consume next" />
      <Section about="Hourly electricity demand (kW) predicted by the LSTM model for the next 24 hours. The dashed line is the same hour one week earlier, a simple reference to judge the forecast against. Peak and total are shown top right.">
        <ForecastChart />
      </Section>
    </>
  );
}

