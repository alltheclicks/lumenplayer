import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

interface OnDemandControlsSurfaceProps {
  fullscreen: boolean;
  playing: boolean;
  interactionOpen: boolean;
  surfaceRef: RefObject<HTMLDivElement>;
  children: ReactNode;
}

/** Inline controls sit below the picture; only fullscreen controls cover it. */
export const OnDemandControlsSurface = ({
  fullscreen,
  playing,
  interactionOpen,
  surfaceRef,
  children,
}: OnDemandControlsSurfaceProps) => {
  const [visible, setVisible] = useState(true);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisible(true);
    if (!fullscreen || !playing || interactionOpen || keyboardFocus) return;
    const surface = surfaceRef.current;
    if (!surface) return;

    let timeout: ReturnType<typeof setTimeout>;
    const reveal = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), 3_000);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') reveal();
    };
    reveal();
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerdown', reveal);
    surface.addEventListener('keydown', reveal);
    return () => {
      clearTimeout(timeout);
      surface.removeEventListener('pointermove', onPointerMove);
      surface.removeEventListener('pointerdown', reveal);
      surface.removeEventListener('keydown', reveal);
    };
  }, [fullscreen, playing, interactionOpen, keyboardFocus, surfaceRef]);

  const hidden = fullscreen && !visible;
  return (
    <>
      {hidden && (
        <button
          type="button"
          className="absolute inset-0 z-20 cursor-default"
          aria-label="Prikaži komande reprodukcije"
          onClick={() => setVisible(true)}
        />
      )}
      <div
        ref={controlsRef}
        data-testid="on-demand-controls"
        onPointerDownCapture={() => setKeyboardFocus(false)}
        onFocusCapture={(event) => {
          if (event.target.matches(':focus-visible')) setKeyboardFocus(true);
          setVisible(true);
        }}
        onBlurCapture={(event) => {
          if (!controlsRef.current?.contains(event.relatedTarget)) setKeyboardFocus(false);
        }}
        className={fullscreen
          ? `absolute inset-x-0 bottom-0 z-30 max-h-full overflow-y-auto bg-gradient-to-t from-black/90 to-transparent p-2.5 transition-opacity sm:p-4 ${hidden ? 'invisible pointer-events-none opacity-0' : 'visible opacity-100'}`
          : 'shrink-0 border-t border-border bg-card p-3 sm:p-4'}
      >
        {children}
      </div>
    </>
  );
};
