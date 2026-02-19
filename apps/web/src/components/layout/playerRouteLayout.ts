export const isPlayerRoutePath = (pathname: string): boolean => (
  pathname === '/player' || pathname.startsWith('/player/')
);

export const getAppShellRootClassName = (isPlayerRoute: boolean): string => (
  isPlayerRoute
    ? 'h-screen overflow-hidden bg-background'
    : 'min-h-screen bg-background'
);

