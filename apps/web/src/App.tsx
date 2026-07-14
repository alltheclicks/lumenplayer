import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from '@/components/ui/toaster';
import { SessionProvider } from '@/context/SessionProvider';
import AppShell from '@/components/layout/AppShell';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RequireAuth } from '@/routes/RequireAuth';
import AnalyticsRouteTracker from '@/components/AnalyticsRouteTracker';
import { BRAND_NAME } from '@/config/brand';

import Login from '@/pages/Login';
import SsoLanding from '@/pages/SsoLanding';
import M3UImport from '@/pages/M3UImport';
import EpgGuide from '@/pages/EpgGuide';
import Settings from '@/pages/Settings';
import VodCategories from '@/pages/VodCategories';
import VodDetail from '@/pages/VodDetail';
import SeriesCategories from '@/pages/SeriesCategories';
import SeriesDetail from '@/pages/SeriesDetail';

const Player = lazy(() => import('@/pages/Player'));
const IS_MANAGED_EXYU_BUILD = BRAND_NAME.trim().toLowerCase() === 'exyu.tv';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

const PlayerRouteFallback = () => (
  <div className="bg-background p-4 md:p-6">
    <div className="mx-auto max-w-3xl text-sm text-muted-foreground">Loading player...</div>
  </div>
);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <SessionProvider>
          <BrowserRouter>
            <AnalyticsRouteTracker />
            <ErrorBoundary>
              <Routes>
                <Route path="/" element={<Navigate to={IS_MANAGED_EXYU_BUILD ? '/player' : '/login'} replace />} />
                <Route path="/login" element={IS_MANAGED_EXYU_BUILD ? <Navigate to="/player" replace /> : <Login />} />
                <Route path="/sso" element={<SsoLanding />} />
                <Route path="/import/m3u" element={IS_MANAGED_EXYU_BUILD ? <Navigate to="/player" replace /> : <M3UImport />} />
                <Route
                  element={(
                    <RequireAuth>
                      <AppShell />
                    </RequireAuth>
                  )}
                >
                  <Route path="/vod" element={<VodCategories />} />
                  <Route path="/vod/:vodId" element={<VodDetail />} />
                  <Route path="/series" element={<SeriesCategories />} />
                  <Route path="/series/:seriesId" element={<SeriesDetail />} />
                  <Route
                    path="/player"
                    element={(
                      <Suspense fallback={<PlayerRouteFallback />}>
                        <Player />
                      </Suspense>
                    )}
                  />
                  <Route path="/epg" element={<EpgGuide />} />
                  <Route path="/settings" element={<Settings />} />
                </Route>
                <Route path="*" element={<Navigate to="/login" replace />} />
              </Routes>
            </ErrorBoundary>
            <Toaster />
          </BrowserRouter>
        </SessionProvider>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

export default App;
