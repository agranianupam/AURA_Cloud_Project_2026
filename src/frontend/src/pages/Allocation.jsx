import React from 'react';
import { Link } from 'react-router-dom';
import AllocationTable from '../components/AllocationTable';
import Section, { PageHeader } from '../components/Section';
import FleetReplay from '../features/fleet/FleetReplay';
import { loadLatestRun } from '../features/fleet/latestRun';

export default function Allocation() {
  const latest = loadLatestRun();
  return (
    <>
      <PageHeader title="Resource Allocation" subtitle="Replay how AURA switches servers on and off" />
      <Section about="Press Play to watch AURA's latest simulation hour by hour: each square is a server (green = on, grey = off), and the log shows every scaling decision it made to follow the forecast.">
        {latest ? (
          <>
            <p className="text-xs text-gray-500 mb-3">
              Showing your latest simulator run: {latest.inputs?.servers ?? latest.result.params?.servers} servers, {latest.result.params?.startDate} to {latest.result.params?.endDate}.
            </p>
            <FleetReplay result={latest.result} />
          </>
        ) : (
          <div className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-4">
            No simulation yet. <Link to="/simulator" className="text-indigo-600 underline">Run a simulation</Link> first, then come back to replay it.
          </div>
        )}
      </Section>
      <Section about="Reference fleet: the example cloud resources from the saved demo data (server, function or ML endpoint) with their size and state. It does not change with your simulations.">
        <AllocationTable />
      </Section>
    </>
  );
}
