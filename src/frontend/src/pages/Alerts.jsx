import React from 'react';
import AlertFeed from '../components/AlertFeed';
import Section, { PageHeader } from '../components/Section';

export default function Alerts() {
  return (
    <>
      <PageHeader title="Alerts" subtitle="Scaling actions and carbon warnings" />
      <Section about="Chronological log of what AURA did or flagged: scale-ups and downs, work moved to low-carbon windows, and threshold breaches. Red is critical, yellow is a warning, blue is informational.">
        <AlertFeed />
      </Section>
    </>
  );
}
