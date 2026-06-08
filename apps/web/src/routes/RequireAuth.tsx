import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { hasConfiguredPlaybackSource } from './routeGuard';

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Redirects to /login when no playback source (Xtream account or M3U playlist)
 * is configured, so the previously-public app routes can no longer be reached
 * directly without credentials. (M1.2-b)
 */
export const RequireAuth = ({ children }: RequireAuthProps) => {
  const location = useLocation();

  if (!hasConfiguredPlaybackSource()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default RequireAuth;
