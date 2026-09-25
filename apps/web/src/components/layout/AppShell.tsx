import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Tv, Film, Clapperboard, CalendarDays, Settings2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSwitchToLiveMode } from '@/pages/switchToLiveMode';
import { getAppShellRootClassName, isPlayerRoutePath } from './playerRouteLayout';
import PlayerFeedbackButton from '@/components/PlayerFeedbackButton';
import { isInfoOnlyAccess } from '@/services/managedAccessMode';

const EXYU_RENEW_URL = 'https://exyu.tv/ponuda';
const EXYU_RECHECK_URL = 'https://exyu.tv/api/player-sso?source=expired_recheck';

const NAV_ITEMS = [
  { path: '/player', label: 'TV uživo', shortLabel: 'TV', icon: Tv },
  { path: '/vod', label: 'Filmovi', shortLabel: 'Filmovi', icon: Film },
  { path: '/series', label: 'Serije', shortLabel: 'Serije', icon: Clapperboard },
  { path: '/epg', label: 'TV unazad', shortLabel: 'Unazad', icon: CalendarDays },
  { path: '/settings', label: 'Podešavanja', shortLabel: 'Opcije', icon: Settings2 },
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
  const infoOnlyAccess = isInfoOnlyAccess();

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
      {infoOnlyAccess && (
        <aside className="fixed inset-x-2 top-2 z-[80] mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-300/35 bg-slate-950/95 px-3 py-2 text-white shadow-2xl backdrop-blur-md sm:inset-x-4 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
            <p className="min-w-0 text-xs leading-snug sm:text-sm">
              <strong>Vaša pretplata je istekla.</strong>{' '}
              Dostupan je samo Info kanal dok ne obnovite gledanje.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold sm:text-sm">
            <a className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-slate-200 hover:bg-white/10" href={EXYU_RECHECK_URL}>
              <RefreshCw className="h-3.5 w-3.5" /> Proveri ponovo
            </a>
            <a className="rounded-lg bg-amber-400 px-3 py-1.5 text-slate-950 hover:bg-amber-300" href={EXYU_RENEW_URL}>
              Obnovi pretplatu
            </a>
          </div>
        </aside>
      )}
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
      {!infoOnlyAccess && <PlayerFeedbackButton />}
    </div>
  );
};

export default AppShell;
