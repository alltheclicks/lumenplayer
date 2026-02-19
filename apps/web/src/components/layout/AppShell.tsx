import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Tv, Film, Clapperboard, CalendarDays, Settings2 } from 'lucide-react';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';
import { getAppShellRootClassName, isPlayerRoutePath } from './playerRouteLayout';

const NAV_ITEMS = [
  { path: '/player', label: 'Live', shortLabel: 'TV', icon: Tv },
  { path: '/vod', label: 'Movies', shortLabel: 'VOD', icon: Film },
  { path: '/series', label: 'Series', shortLabel: 'SER', icon: Clapperboard },
  { path: '/epg', label: 'Catch-up', shortLabel: 'EPG', icon: CalendarDays },
  { path: '/settings', label: 'Settings', shortLabel: 'CFG', icon: Settings2 },
] as const;

const isActiveRoute = (itemPath: string, currentPath: string): boolean => {
  if (itemPath === '/player') {
    return currentPath === '/player' || currentPath.startsWith('/player/');
  }

  return currentPath.startsWith(itemPath);
};

const AppShell = () => {
  const { pathname } = useLocation();
  const switchToLiveMode = useSwitchToLiveMode();
  const isPlayerRoute = isPlayerRoutePath(pathname);
  const hasRouteOwnedMobileNav = pathname === '/vod' || pathname === '/series';
  const shellRootClassName = getAppShellRootClassName(isPlayerRoute);

  useEffect(() => {
    const playerScrollLockClass = 'player-route-scroll-lock';
    if (isPlayerRoute) {
      document.body.classList.add(playerScrollLockClass);
      return () => {
        document.body.classList.remove(playerScrollLockClass);
      };
    }

    document.body.classList.remove(playerScrollLockClass);
    return undefined;
  }, [isPlayerRoute]);

  return (
    <div className={shellRootClassName}>
      <div className={isPlayerRoute ? 'h-full' : hasRouteOwnedMobileNav ? '' : 'pb-16 md:pb-0'}>
        <Outlet />
      </div>

      {!isPlayerRoute && !hasRouteOwnedMobileNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="flex items-center justify-around py-2">
            {NAV_ITEMS.map((item) => {
              const active = isActiveRoute(item.path, pathname);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={(event) => {
                    if (item.path !== '/player') {
                      return;
                    }

                    event.preventDefault();
                    switchToLiveMode();
                  }}
                  className={`flex flex-col items-center gap-1 px-4 py-2 transition-colors ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
};

export default AppShell;
