import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Tv, Film, Clapperboard, CalendarDays, Settings2 } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/player', label: 'Live', icon: Tv },
  { path: '/vod', label: 'VOD', icon: Film },
  { path: '/series', label: 'Series', icon: Clapperboard },
  { path: '/epg', label: 'EPG', icon: CalendarDays },
  { path: '/settings', label: 'Settings', icon: Settings2 },
] as const;

const isActiveRoute = (itemPath: string, currentPath: string): boolean => {
  if (itemPath === '/player') {
    return currentPath === '/player' || currentPath.startsWith('/player/');
  }

  return currentPath.startsWith(itemPath);
};

const AppShell = () => {
  const { pathname } = useLocation();
  const isPlayerRoute = pathname === '/player' || pathname.startsWith('/player/');

  return (
    <div className="min-h-screen bg-background flex">
      {/* Desktop icon sidebar — hidden on /player where Player.tsx has its own sidebar */}
      {!isPlayerRoute && (
        <aside className="hidden lg:flex w-16 flex-col items-center border-r border-border bg-card py-4 gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActiveRoute(item.path, pathname);
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg text-xs transition-colors ${
                  active
                    ? 'bg-primary/15 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
                title={item.label}
              >
                <item.icon className="h-5 w-5" />
                <span className="mt-1 leading-none">{item.label}</span>
              </NavLink>
            );
          })}
        </aside>
      )}

      {/* Main content area */}
      <div className={`flex-1 flex flex-col ${isPlayerRoute ? '' : 'pb-14 lg:pb-0'}`}>
        <Outlet />
      </div>

      {/* Mobile bottom nav bar — hidden on /player where Player.tsx owns the mobile layout */}
      <nav className={`fixed bottom-0 inset-x-0 z-40 flex lg:hidden border-t border-border bg-card pb-[env(safe-area-inset-bottom)] ${isPlayerRoute ? 'hidden' : ''}`}>
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(item.path, pathname);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors ${
                active
                  ? 'text-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="leading-none">{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};

export default AppShell;
