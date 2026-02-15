import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeThemePreference } from '@/services/appSettings';

initializeThemePreference();

createRoot(document.getElementById('root')!).render(<App />);
