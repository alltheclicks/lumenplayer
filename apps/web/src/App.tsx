import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from '@/components/ui/toaster';
import { SessionProvider } from '@/context/SessionProvider';

import Login from '@/pages/Login';
import M3UImport from '@/pages/M3UImport';
import Player from '@/pages/Player';
import EpgGuide from '@/pages/EpgGuide';
import VodCategories from '@/pages/VodCategories';
import VodDetail from '@/pages/VodDetail';
import SeriesCategories from '@/pages/SeriesCategories';
import SeriesDetail from '@/pages/SeriesDetail';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

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
              <Route path="/vod" element={<VodCategories />} />
              <Route path="/vod/:vodId" element={<VodDetail />} />
              <Route path="/series" element={<SeriesCategories />} />
              <Route path="/series/:seriesId" element={<SeriesDetail />} />
              <Route path="/player" element={<Player />} />
              <Route path="/epg" element={<EpgGuide />} />
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
