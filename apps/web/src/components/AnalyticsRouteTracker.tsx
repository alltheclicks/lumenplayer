import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPlayerRoute } from '@/services/playerAnalytics';

const AnalyticsRouteTracker = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPlayerRoute(pathname);
  }, [pathname]);

  return null;
};

export default AnalyticsRouteTracker;
