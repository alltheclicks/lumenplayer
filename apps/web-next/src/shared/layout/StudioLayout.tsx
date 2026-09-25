import { Aperture, GitBranch, MonitorPlay, PanelsTopLeft } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { STUDIO_BRANCH, STUDIO_PORT } from '@/features/studio/data/lumenStudioGateway';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Aperture;
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/studio', label: 'Overview', icon: Aperture, end: true },
  { to: '/player', label: 'Player', icon: MonitorPlay },
  { to: '/vod', label: 'Movies', icon: PanelsTopLeft },
  { to: '/studio/merge-plan', label: 'Merge Plan', icon: GitBranch },
];

const getNavClassName = (isActive: boolean): string => (
  [
    'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-all',
    isActive
      ? 'border-primary/40 bg-primary/15 text-foreground'
      : 'border-border bg-secondary/50 text-muted-foreground hover:border-primary/30 hover:bg-secondary hover:text-foreground',
  ].join(' ')
);

const StudioLayout = () => (
  <div className="min-h-screen bg-background pb-8">
    <header className="border-b border-border bg-card/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Lumen Next Studio</div>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Sandbox Docs</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="rounded-full border border-border px-3 py-1">{STUDIO_BRANCH}</span>
            <span className="rounded-full border border-border px-3 py-1">:{STUDIO_PORT}</span>
          </div>
        </div>

        <nav className="flex flex-wrap gap-2">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => getNavClassName(isActive)}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>

    <main className="mx-auto max-w-[1440px] px-4 py-6 md:px-6">
      <Outlet />
    </main>
  </div>
);

export default StudioLayout;
