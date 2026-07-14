import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { BRAND_NAME } from '@/config/brand';
import { hasConfiguredPlaybackSource } from './routeGuard';

interface RequireAuthProps {
  children: ReactNode;
}

type ManagedAccessState = 'checking' | 'allowed' | 'reauthenticating';

const EXYU_SSO_ENTRY_URL = 'https://exyu.tv/api/player-sso?source=player_direct';
const REQUIRES_EXYU_SSO = BRAND_NAME.trim().toLowerCase() === 'exyu.tv';

/**
 * Redirects to /login when no playback source (Xtream account or M3U playlist)
 * is configured, so the previously-public app routes can no longer be reached
 * directly without credentials. (M1.2-b)
 */
export const RequireAuth = ({ children }: RequireAuthProps) => {
  const location = useLocation();
  const hasPlaybackSource = hasConfiguredPlaybackSource();
  const [managedAccess, setManagedAccess] = useState<ManagedAccessState>(
    REQUIRES_EXYU_SSO && hasPlaybackSource ? 'checking' : 'allowed',
  );

  useEffect(() => {
    if (!REQUIRES_EXYU_SSO || !hasPlaybackSource) {
      setManagedAccess('allowed');
      return;
    }

    let cancelled = false;
    const verifyAccess = async () => {
      try {
        const response = await fetch('/player-analytics/config', {
          method: 'GET',
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
        });
        if (cancelled) return;
        if (response.status === 401) {
          setManagedAccess('reauthenticating');
          window.location.replace(EXYU_SSO_ENTRY_URL);
          return;
        }
        // Analytics/config outages must not take television offline. A missing
        // or expired signed binding (401) is the only response that requires a
        // fresh subscription-checked EXYU hand-off.
        setManagedAccess('allowed');
      } catch {
        if (!cancelled) setManagedAccess('allowed');
      }
    };

    void verifyAccess();
    return () => { cancelled = true; };
  }, [hasPlaybackSource]);

  if (!hasPlaybackSource) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (managedAccess !== 'allowed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
        <div className="max-w-md text-center">
          <p className="text-lg font-semibold">
            {managedAccess === 'checking' ? 'Proveravamo EXYU prijavu…' : 'Obnavljamo EXYU prijavu…'}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Ako se stranica ne otvori automatski,{' '}
            <a className="font-medium text-primary underline" href={EXYU_SSO_ENTRY_URL}>
              nastavite preko EXYU.tv
            </a>.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default RequireAuth;
