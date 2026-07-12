import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Tv, Film, Clapperboard, CalendarDays, Settings2 } from 'lucide-react';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';
import { getAppShellRootClassName, isPlayerRoutePath } from './playerRouteLayout';
import PlayerFeedbackButton from '@/components/PlayerFeedbackButton';

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
      <div className={isPlayerRoute ? 'h-full min-h-0 w-full max-w-[100vw] overflow-hidden' : hasRouteOwnedMobileNav ? '' : 'pb-16 md:pb-0'}>
        <Outlet />
      </div>

      {!isPlayerRoute && !hasRouteOwnedMobileNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
          <div className="flex items-center justify-around py-1.5">
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
                  className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1.5 py-1.5 transition-colors ${
                    active ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="text-[10px] font-medium sm:hidden">{item.shortLabel}</span>
                  <span className="hidden text-xs font-medium sm:inline">{item.label}</span>
                </NavLink>
              );
            })}
          </div>
        </nav>
      )}
      <PlayerFeedbackButton />
    </div>
  );
};

export default AppShell;
