import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  XTREAM_SERVER_URL,
  isServerConfigured,
  resolveXtreamCanonicalServer,
} from '@/config/xtream';
import { loadXtreamCredentials, saveXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import { AlertCircle, Loader2, Tv } from 'lucide-react';

const EXYU_PLAYER_PAGE_URL = 'https://exyu.tv/player';

type SsoStatus = 'exchanging' | 'unconfigured' | 'error';

/**
 * Landing route for the exyu.tv -> player SSO hand-off. exyu.tv redirects a
 * signed-in subscriber to `/sso#token=<t>`; the token is stripped from the URL
 * immediately, exchanged for Xtream credentials at `/sso/exchange`, validated
 * against the Xtream server, and stored like a normal login.
 */
const SsoLanding = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<SsoStatus>('exchanging');
  const startedRef = useRef(false);

  useEffect(() => {
    // Tokens are single-use: guard against the StrictMode double-effect.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    const hash = window.location.hash;
    const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
    window.history.replaceState(null, '', '/sso');

    const fallbackToExistingSession = async (): Promise<boolean> => {
      const existing = await loadXtreamCredentials();
      if (existing) {
        navigate('/player', { replace: true });
        return true;
      }
      return false;
    };

    const run = async () => {
      if (!token) {
        if (!(await fallbackToExistingSession())) {
          navigate('/login', { replace: true });
        }
        return;
      }

      if (!isServerConfigured()) {
        setStatus('unconfigured');
        return;
      }

      try {
        const response = await fetch('/sso/exchange', {
          method: 'POST',
          cache: 'no-store',
          credentials: 'same-origin',
          referrerPolicy: 'no-referrer',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!response.ok) {
          throw new Error(`sso_exchange_failed_${response.status}`);
        }

        const data = (await response.json()) as { username?: unknown; password?: unknown };
        if (typeof data.username !== 'string' || typeof data.password !== 'string') {
          throw new Error('sso_exchange_invalid_response');
        }

        const credentials = {
          server: XTREAM_SERVER_URL,
          username: data.username,
          password: data.password,
        };

        xtreamCodesService.setCredentials(credentials);
        const authResponse = await xtreamCodesService.authenticate();
        if (authResponse.user_info?.auth !== 1) {
          throw new Error('sso_xtream_auth_failed');
        }

        const canonicalServer = resolveXtreamCanonicalServer(
          credentials.server,
          authResponse.server_info,
        );
        const canonicalCredentials = canonicalServer === credentials.server
          ? credentials
          : { ...credentials, server: canonicalServer };
        await saveXtreamCredentials(canonicalCredentials);
        navigate('/player', { replace: true });
      } catch (err) {
        console.error('SSO sign-in error:', err instanceof Error ? err.message : err);
        if (!(await fallbackToExistingSession())) {
          setStatus('error');
        }
      }
    };

    void run();
  }, [navigate]);

  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="googlebot" content="noindex, nofollow" />
      </Helmet>

      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-border/60 bg-card/95">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Tv className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">
              {status === 'error' ? 'Prijava nije uspela' : 'Prijava u toku'}
            </CardTitle>
            <CardDescription>
              {status === 'error'
                ? 'Link za prijavu je istekao ili nije važeći.'
                : 'Povezujemo vaš EXYU nalog sa plejerom...'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            {status === 'exchanging' && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Samo trenutak...
              </div>
            )}

            {status === 'unconfigured' && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  IPTV server nije konfigurisan. Administrator treba da podesi{' '}
                  <code className="rounded bg-secondary px-1 text-xs">VITE_XTREAM_SERVER</code> u
                  environment varijablama.
                </AlertDescription>
              </Alert>
            )}

            {status === 'error' && (
              <div className="space-y-3">
                <Button className="w-full" asChild>
                  <a href={EXYU_PLAYER_PAGE_URL}>Nazad na EXYU.tv</a>
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate('/login', { replace: true })}
                >
                  Prijava korisničkim imenom i lozinkom
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default SsoLanding;
