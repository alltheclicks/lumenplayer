import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from '@/components/ui/toaster';
import { SessionProvider } from '@/context/SessionProvider';
import AppShell from '@/components/layout/AppShell';

import Login from '@/pages/Login';
import M3UImport from '@/pages/M3UImport';
import EpgGuide from '@/pages/EpgGuide';
import Settings from '@/pages/Settings';
import VodCategories from '@/pages/VodCategories';
import VodDetail from '@/pages/VodDetail';
import SeriesCategories from '@/pages/SeriesCategories';
import SeriesDetail from '@/pages/SeriesDetail';

const Player = lazy(() => import('@/pages/Player'));

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
            <Routes>
              <Route path="/" element={<Navigate to="/login" replace />} />
              <Route path="/login" element={<Login />} />
              <Route path="/import/m3u" element={<M3UImport />} />
              <Route element={<AppShell />}>
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
            <Toaster />
          </BrowserRouter>
        </SessionProvider>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

export default App;
