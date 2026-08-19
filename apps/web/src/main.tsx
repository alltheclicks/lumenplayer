import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeThemePreference } from '@/services/appSettings';
import { initializePlayerAnalytics } from '@/services/playerAnalytics';

initializeThemePreference();
initializePlayerAnalytics();

createRoot(document.getElementById('root')!).render(<App />);
