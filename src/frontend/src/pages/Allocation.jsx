import React from 'react';
import AllocationTable from '../components/AllocationTable';
import Section, { PageHeader } from '../components/Section';

export default function Allocation() {
  return (
    <>
      <PageHeader title="Resource Allocation" subtitle="Cloud resources AURA is managing" />
      <Section about="Each row is a cloud resource (server, function or ML endpoint) with its size and current state. AURA starts, stops or resizes these to follow forecast demand.">
        <AllocationTable />
      </Section>
    </>
  );
}
