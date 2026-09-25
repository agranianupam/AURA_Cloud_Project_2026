import React from 'react';
import SavingsKPIs from '../components/SavingsKPIs';
import EnergyChart from '../components/EnergyChart';
import AlertFeed from '../components/AlertFeed';
import AllocationTable from '../components/AllocationTable';
import ComparisonChart from '../components/ComparisonChart';

export default function Dashboard({ userEmail = "admin@aura.edu", onLogout }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-end pb-4 border-b border-gray-200">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">AURA Command Center</h1>
            <p className="text-gray-500 mt-1 text-sm">Autonomous University Resource Allocator</p>
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <span className="px-3 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-full border border-green-200">System Healthy</span>
            <div className="text-xs text-gray-500 flex gap-2 items-center">
               <span>{userEmail}</span>
               {onLogout && <button onClick={onLogout} className="text-indigo-600 hover:underline">Logout</button>}
            </div>
          </div>
        </div>

        <SavingsKPIs />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><ComparisonChart /></div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><EnergyChart /></div>
          <div className="lg:col-span-1"><AlertFeed /></div>
        </div>
        <div>
          <AllocationTable />
        </div>
      </div>
    </div>
  );
}
