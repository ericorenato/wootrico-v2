import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  LayoutDashboard,
  Plug,
  KeyRound,
  Terminal,
  SlidersHorizontal,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/integrations', label: 'Integrações', icon: Plug },
  { to: '/system', label: 'Sistema', icon: SlidersHorizontal },
  { to: '/license', label: 'Licença', icon: KeyRound },
  { to: '/logs', label: 'Logs', icon: Terminal },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-black text-white flex">
      <aside className="hidden md:flex w-64 flex-col bg-gradient-to-br from-white/10 to-white/0 border-r border-white/5 px-5 py-6">
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-9 h-9 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
            <span className="text-blue-400 font-bold">W</span>
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Wootrico</p>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-500">Painel</p>
          </div>
        </div>

        <nav className="space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1A1A1D] text-white border border-white/5'
                    : 'text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-6">
          <div className="px-2 mb-3">
            <p className="text-xs text-neutral-400 truncate">{user?.email}</p>
            <p className="text-[10px] uppercase tracking-wider text-neutral-600">{user?.role}</p>
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="flex items-center gap-3 px-4 py-3 w-full rounded-xl text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut size={16} />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 bg-[#050509] min-h-screen">
        <div className="max-w-6xl mx-auto px-6 py-10">{children}</div>
      </main>
    </div>
  );
}
