export const resolveCatchUpClockActionTarget = (
  hasLiveCatchUpSection: boolean
): 'scroll-to-section' | 'open-epg' => (
  hasLiveCatchUpSection ? 'scroll-to-section' : 'open-epg'
);
