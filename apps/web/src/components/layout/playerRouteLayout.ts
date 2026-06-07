export const isPlayerRoutePath = (pathname: string): boolean => (
  pathname === '/player' || pathname.startsWith('/player/')
);

export const getAppShellRootClassName = (isPlayerRoute: boolean): string => (
  isPlayerRoute
    ? 'h-[100dvh] min-h-[100svh] w-full max-w-[100vw] overflow-hidden bg-background lg:h-screen'
    : 'min-h-screen bg-background'
);
