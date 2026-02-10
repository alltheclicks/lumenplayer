# IPTV Player Standalone

A standalone IPTV player application built with React, TypeScript, and Vite. Supports Xtream Codes API for live TV streaming.

## Features

- Live TV streaming via Xtream Codes API
- HLS playback with hls.js
- Catch-up/Timeshift functionality
- Favorite channels (stored locally)
- Responsive design (desktop & mobile)
- PWA support
- Dark theme

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure IPTV server
cp .env.example .env
# Edit .env and set VITE_XTREAM_SERVER

# 3. Start development server
npm run dev

# 4. Open http://localhost:8080
```

## Configuration

Create a `.env` file with your IPTV server:

```env
VITE_XTREAM_SERVER=http://your-iptv-server.com:8080
```

Users will only need to enter their username and password.

## Build

```bash
# Production build
npm run build

# Preview production build
npm run preview
```

## Tech Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- hls.js
- TanStack Query
- React Router

## Project Structure

```
src/
├── components/
│   ├── player/        # Video player components
│   └── ui/            # shadcn/ui components
├── hooks/             # React hooks
├── services/          # API services
├── config/            # Configuration
├── types/             # TypeScript types
├── data/              # Mock data
├── lib/               # Utilities
└── pages/             # Page components
```

## Customization

### Colors

Edit CSS variables in `src/index.css`:

```css
:root {
  --primary: 217 91% 60%;  /* Main color */
  --background: 0 0% 4%;   /* Background */
}
```

### App Name

Edit `vite.config.ts` manifest section.

### Icons

Replace files in `public/` folder.

## HTTPS Note

If your IPTV server uses HTTP, the player must also be accessed via HTTP (not HTTPS) due to browser mixed-content restrictions.

## License

MIT
