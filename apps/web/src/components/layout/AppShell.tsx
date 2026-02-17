import { useMemo } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Tv, Film, Clapperboard, CalendarDays, Settings2 } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/player', label: 'Live', shortLabel: 'TV', icon: Tv },
  { path: '/vod', label: 'Movies', shortLabel: 'VOD', icon: Film },
  { path: '/series', label: 'Series', shortLabel: 'SER', icon: Clapperboard },
  { path: '/epg', label: 'Catch-up', shortLabel: 'EPG', icon: CalendarDays },
  { path: '/settings', label: 'Settings', shortLabel: 'CFG', icon: Settings2 },
] as const;

const ROUTE_META = [
  { path: '/vod', title: 'Movies', subtitle: 'Browse and launch on-demand movies' },
  { path: '/series', title: 'Series', subtitle: 'Explore seasons and episode playback' },
  { path: '/epg', title: 'Catch-up', subtitle: 'Program timeline and replay entry points' },
  { path: '/settings', title: 'Settings', subtitle: 'Player preferences, startup mode and theme' },
] as const;

const isActiveRoute = (itemPath: string, currentPath: string): boolean => {
  if (itemPath === '/player') {
    return currentPath === '/player' || currentPath.startsWith('/player/');
  }

  return currentPath.startsWith(itemPath);
};

const resolveRouteMeta = (pathname: string): { title: string; subtitle: string } => {
  const matching = ROUTE_META.find((route) => pathname.startsWith(route.path));
  if (matching) {
    return {
      title: matching.title,
      subtitle: matching.subtitle,
    };
  }

  return {
    title: 'Lumen Player',
    subtitle: 'Session-driven playback shell',
  };
};

const AppShell = () => {
  const { pathname } = useLocation();
  const isPlayerRoute = pathname === '/player' || pathname.startsWith('/player/');
  const routeMeta = useMemo(() => resolveRouteMeta(pathname), [pathname]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop icon sidebar — hidden on /player where Player.tsx has its own sidebar */}
      {!isPlayerRoute && (
        <aside className="shell-surface hidden w-[5.75rem] shrink-0 flex-col border-r border-[hsl(var(--shell-border))] lg:flex">
          <div className="border-b border-[hsl(var(--shell-border))] px-3 py-4">
            <p className="text-[0.625rem] font-semibold uppercase tracking-[0.24em] text-primary/80">Lumen</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/90">Player</p>
          </div>

          <nav className="flex-1 space-y-1 px-2 py-3">
            {NAV_ITEMS.map((item) => {
              const active = isActiveRoute(item.path, pathname);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={`flex min-h-16 flex-col items-center justify-center rounded-xl border text-[10px] font-semibold uppercase tracking-[0.16em] transition-all ${
                    active
                      ? 'border-primary/40 bg-primary/15 text-foreground shadow-sm'
                      : 'border-transparent text-muted-foreground hover:border-primary/20 hover:bg-accent/70 hover:text-foreground'
                  }`}
                  title={item.label}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="mt-1 leading-none">{item.shortLabel}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="border-t border-[hsl(var(--shell-border))] px-2 py-3 text-center">
            <p className="text-[0.625rem] uppercase tracking-[0.18em] text-muted-foreground">Session UI</p>
          </div>
        </aside>
      )}

      {/* Main content area */}
      <div className={`flex-1 flex min-h-screen flex-col ${isPlayerRoute ? '' : 'pb-16 lg:pb-0'}`}>
        {!isPlayerRoute && (
          <header className="sticky top-0 z-30 border-b border-[hsl(var(--shell-border))] bg-background/80 backdrop-blur-md">
            <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-3 md:px-6">
              <div>
                <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-primary/80">
                  Lumen Shell
                </p>
                <h1 className="mt-1 text-xl font-semibold text-foreground">{routeMeta.title}</h1>
                <p className="text-xs text-muted-foreground">{routeMeta.subtitle}</p>
              </div>
            </div>
          </header>
        )}
        <div className="flex-1">
          <Outlet />
        </div>
      </div>

      {/* Mobile bottom nav bar — hidden on /player where Player.tsx owns the mobile layout */}
      <nav className={`fixed bottom-0 inset-x-0 z-40 flex border-t border-[hsl(var(--shell-border))] bg-[hsl(var(--surface-1)/0.96)] backdrop-blur lg:hidden pb-[env(safe-area-inset-bottom)] ${isPlayerRoute ? 'hidden' : ''}`}>
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(item.path, pathname);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`mx-1 my-1 flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                active
                  ? 'bg-primary/15 text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              <item.icon className="h-4 w-4" />
              <span className="leading-none">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};

export default AppShell;
