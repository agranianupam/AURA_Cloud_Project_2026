import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, TrendingUp, Server, Leaf, Bell, Network, FlaskConical, Menu, X,
  Search, Sun, Moon, RefreshCw, LogOut, Radio, Pause, Zap,
} from 'lucide-react';
import CommandPalette from '../components/CommandPalette';
import useAlertWatcher from '../hooks/useAlertWatcher';
import { usePrefs } from '../hooks/usePrefs';

const NAV = [
  { to: '/overview', label: 'Overview', icon: LayoutDashboard },
  { to: '/forecast', label: 'Forecast', icon: TrendingUp },
  { to: '/allocation', label: 'Allocation', icon: Server },
  { to: '/carbon', label: 'Carbon and Energy', icon: Leaf },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/architecture', label: 'Architecture', icon: Network },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical },
];

const timeAgo = (d, now) => {
  if (!d) return 'syncing…';
  const s = Math.max(0, Math.round((now - d) / 1000));
  if (s < 5) return 'just now';
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

function IconButton({ label, onClick, className = '', children }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

export default function Layout({ userEmail, onLogout }) {
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [spin, setSpin] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme, live, toggleLive, refreshAll } = usePrefs();
  const { unread, lastSync, error: syncError } = useAlertWatcher(pathname === '/alerts');

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const commands = useMemo(() => {
    const refresh = () => {
      refreshAll();
      setSpin(true);
      setTimeout(() => setSpin(false), 700);
    };
    return [
      ...NAV.map((n) => ({
        id: n.to, group: 'Pages', label: n.label, icon: n.icon,
        hint: n.to === pathname ? 'current' : null, run: () => navigate(n.to),
      })),
      { id: 'theme', group: 'Actions', label: theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode', icon: theme === 'dark' ? Sun : Moon, keywords: 'theme dark light appearance', run: toggleTheme },
      { id: 'live', group: 'Actions', label: live ? 'Pause live updates' : 'Resume live updates', icon: live ? Pause : Radio, keywords: 'auto refresh polling live', run: toggleLive },
      { id: 'refresh', group: 'Actions', label: 'Refresh all data', icon: RefreshCw, keywords: 'reload sync', run: refresh },
      ...(onLogout ? [{ id: 'logout', group: 'Account', label: 'Log out', icon: LogOut, keywords: 'sign out', run: onLogout }] : []),
    ];
  }, [pathname, theme, live, navigate, toggleTheme, toggleLive, refreshAll, onLogout]);

  const runCommand = (id) => commands.find((c) => c.id === id)?.run();

  const status = syncError
    ? { text: 'API unreachable', dot: 'bg-red-500', ring: 'border-red-200 bg-red-50 text-red-700' }
    : { text: 'All systems normal', dot: 'bg-emerald-500', ring: 'border-emerald-200 bg-emerald-50 text-emerald-700' };

  return (
    <div className="min-h-screen bg-gray-50 md:flex">
      {open && <div className="fixed inset-0 z-30 bg-slate-950/40 md:hidden" onClick={() => setOpen(false)} />}

      <aside
        className={`fixed z-40 inset-y-0 left-0 w-64 flex flex-col bg-white border-r border-gray-200 p-4 transition-transform duration-200
          ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 md:sticky md:top-0 md:h-screen md:shrink-0`}
      >
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-emerald-400 flex items-center justify-center shadow-md shadow-indigo-500/30">
            <Zap className="w-5 h-5 text-white" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-gray-900 tracking-tight leading-none">AURA</h1>
            <p className="text-[11px] text-gray-500 truncate mt-1">Autonomous University Resource Allocator</p>
          </div>
          <IconButton label="Close menu" onClick={() => setOpen(false)} className="md:hidden ml-auto"><X className="w-5 h-5" /></IconButton>
        </div>

        <p className="px-3 mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Navigation</p>
        <nav className="space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-indigo-600" />}
                  <Icon className="w-4 h-4" />
                  <span className="flex-1">{label}</span>
                  {to === '/alerts' && unread > 0 && (
                    <span className="min-w-5 h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[11px] font-bold">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-4 space-y-3">
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${status.ring}`}>
            <span className="relative flex w-2 h-2">
              {!syncError && <span className={`absolute inset-0 rounded-full ${status.dot} animate-ping opacity-60`} />}
              <span className={`relative w-2 h-2 rounded-full ${status.dot}`} />
            </span>
            {status.text}
          </div>
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 shrink-0 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-sm font-bold uppercase">
              {userEmail?.[0] || 'A'}
            </div>
            <div className="min-w-0 flex-1 text-xs text-gray-600 truncate">{userEmail}</div>
            {onLogout && <IconButton label="Log out" onClick={onLogout}><LogOut className="w-4 h-4" /></IconButton>}
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-2 px-4 md:px-8 h-16 bg-gray-50/80 backdrop-blur-md border-b border-gray-200">
          <IconButton label="Open menu" onClick={() => setOpen(true)} className="md:hidden"><Menu className="w-5 h-5" /></IconButton>
          <div className="hidden sm:flex items-center gap-2 text-sm text-gray-500 min-w-0">
            <span>AURA</span><span className="text-gray-300">/</span>
            <span className="font-semibold text-gray-900 truncate">{current(pathname)}</span>
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex items-center gap-2 h-9 pl-3 pr-2 w-full max-w-60 rounded-lg border border-gray-200 bg-white text-sm text-gray-400 hover:border-gray-300 transition-colors"
          >
            <Search className="w-4 h-4" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="hidden sm:inline text-[10px] font-medium text-gray-500 border border-gray-200 rounded px-1.5 py-0.5">Ctrl K</kbd>
          </button>

          <button
            onClick={toggleLive}
            title={live ? 'Live updates every 30s. Click to pause.' : 'Live updates paused. Click to resume.'}
            className={`hidden sm:inline-flex items-center gap-2 h-9 px-3 shrink-0 rounded-lg border text-xs font-medium transition-colors ${
              live ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-500'}`}
          >
            {live ? <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> : <Pause className="w-3.5 h-3.5" />}
            {live ? `Live · ${timeAgo(lastSync, now)}` : 'Paused'}
          </button>

          <IconButton label="Refresh all data" onClick={() => runCommand('refresh')}>
            <RefreshCw className={`w-4 h-4 ${spin ? 'animate-spin' : ''}`} />
          </IconButton>
          <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </IconButton>
        </header>

        <main className="flex-1 p-4 md:p-8">
          <div key={pathname} className="aura-page max-w-6xl mx-auto space-y-6">
            <Outlet />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}

const current = (pathname) => NAV.find((n) => pathname.startsWith(n.to))?.label || 'Dashboard';
