import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Providers } from '@/app/providers';
import StudioLayout from '@/shared/layout/StudioLayout';
import CatalogLabPage from '@/features/studio/pages/CatalogLabPage';
import LiveShellPage from '@/features/studio/pages/LiveShellPage';
import MergePlanPage from '@/features/studio/pages/MergePlanPage';
import SeriesLabPage from '@/features/studio/pages/SeriesLabPage';
import StudioHomePage from '@/features/studio/pages/StudioHomePage';

const App = () => (
  <Providers>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/player" replace />} />
        <Route path="/player" element={<LiveShellPage />} />
        <Route path="/vod" element={<CatalogLabPage />} />
        <Route path="/series" element={<SeriesLabPage />} />
        <Route path="/studio" element={<StudioLayout />}>
          <Route index element={<StudioHomePage />} />
          <Route path="merge-plan" element={<MergePlanPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/player" replace />} />
      </Routes>
    </BrowserRouter>
  </Providers>
);

export default App;
