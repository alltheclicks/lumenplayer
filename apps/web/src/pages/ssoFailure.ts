export const isSsoAccountRejected = (code: string | null): boolean => (
  code === 'sso_xtream_subscription_inactive' || code === 'sso_xtream_auth_failed'
);

export const ssoFailureDescription = (code: string | null, stage: string | null): string => {
  if (code === 'sso_xtream_subscription_inactive') return 'TV pretplata nije aktivna. Proverite pristup preko svog EXYU.tv naloga.';
  if (code === 'sso_xtream_auth_failed') return 'TV server nije prihvatio podatke za ovaj nalog. Vratite se na EXYU.tv nalog i proverite pristup ili se obratite podršci.';
  if (code === 'sso_exchange_failed_429') return 'Previše pokušaja prijave. Sačekajte minut, pa ponovo otvorite plejer preko EXYU.tv naloga.';
  if (code === 'sso_exchange_failed_401' || code === 'sso_exchange_failed_403') return 'Link za prijavu je istekao ili nije važeći. Otvorite novi link preko EXYU.tv naloga.';
  if (stage === 'credential_storage') return 'Pregledač nije uspeo da sačuva prijavu. Pokušajte ponovo.';
  return 'Povezivanje sa TV serverom trenutno nije uspelo. Pokušajte ponovo preko EXYU.tv naloga za nekoliko trenutaka.';
};
