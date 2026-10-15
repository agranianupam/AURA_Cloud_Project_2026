import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, TrendingUp, Server, Leaf, Bell, Network, FlaskConical, Menu, X } from 'lucide-react';

const NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp },
  { to: '/allocation', label: 'Allocation', icon: Server },
  { to: '/carbon', label: 'Carbon and Energy', icon: Leaf },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/architecture', label: 'Architecture', icon: Network },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical },
];

export default function Layout({ userEmail, onLogout }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      <header className="md:hidden flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3 sticky top-0 z-20">
        <span className="font-bold text-gray-900">AURA</span>
        <button aria-label="Toggle menu" onClick={() => setOpen(!open)} className="p-1">
          {open ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </header>

      <aside className={`${open ? 'block' : 'hidden'} md:flex md:flex-col md:w-60 md:shrink-0 bg-white border-r border-gray-200 p-4 md:sticky md:top-0 md:h-screen`}>
        <div className="hidden md:block mb-6">
          <h1 className="text-xl font-bold text-gray-900 tracking-tight">AURA</h1>
          <p className="text-xs text-gray-500">Autonomous University Resource Allocator</p>
        </div>
        <nav className="space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium ${isActive ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <Icon className="w-4 h-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 md:mt-auto pt-4 border-t border-gray-100 text-xs text-gray-500 space-y-2">
          <span className="inline-block px-2 py-0.5 bg-green-100 text-green-800 font-bold rounded-full border border-green-200">System Healthy</span>
          <div className="truncate">{userEmail}</div>
          {onLogout && <button onClick={onLogout} className="text-indigo-600 hover:underline">Logout</button>}
        </div>
      </aside>

      <main className="flex-1 min-w-0 p-4 md:p-8">
        <div className="max-w-6xl mx-auto space-y-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
