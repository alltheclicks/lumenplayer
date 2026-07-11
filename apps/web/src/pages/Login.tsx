import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import {
  XTREAM_SERVER_URL,
  isServerConfigured,
  resolveXtreamCanonicalServer,
} from '@/config/xtream';
import { loadXtreamCredentials, saveXtreamCredentials } from '@/services/xtreamCredentials';
import { xtreamCodesService } from '@/services/xtreamService';
import { AlertCircle, Eye, EyeOff, Loader2, Tv } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const serverConfigured = isServerConfigured();

  useEffect(() => {
    let mounted = true;
    const bootstrapCredentials = async () => {
      const credentials = await loadXtreamCredentials();
      if (mounted && credentials) {
        navigate('/player', { replace: true });
      }
    };

    void bootstrapCredentials();

    return () => {
      mounted = false;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!serverConfigured) {
      toast({
        variant: 'destructive',
        title: 'Greška',
        description: 'IPTV server nije konfigurisan.',
      });
      return;
    }

    if (!username.trim()) {
      toast({
        variant: 'destructive',
        title: 'Greška',
        description: 'Unesite korisničko ime.',
      });
      return;
    }

    if (!password.trim()) {
      toast({
        variant: 'destructive',
        title: 'Greška',
        description: 'Unesite lozinku.',
      });
      return;
    }

    setIsLoading(true);

    try {
      const credentials = {
        server: XTREAM_SERVER_URL,
        username: username.trim(),
        password: password.trim(),
      };

      xtreamCodesService.setCredentials(credentials);
      const response = await xtreamCodesService.authenticate();

      if (response.user_info?.auth === 1) {
        const canonicalServer = resolveXtreamCanonicalServer(
          credentials.server,
          response.server_info,
        );
        const canonicalCredentials = canonicalServer === credentials.server
          ? credentials
          : { ...credentials, server: canonicalServer };
        await saveXtreamCredentials(canonicalCredentials);
        toast({
          title: 'Uspešna prijava',
          description: 'Dobrodošli nazad!',
        });
        navigate('/player');
      } else {
        toast({
          variant: 'destructive',
          title: 'Neuspešna prijava',
          description: 'Pogrešno korisničko ime ili lozinka.',
        });
      }
    } catch (err) {
      console.error('Login error:', err);
      toast({
        variant: 'destructive',
        title: 'Greška',
        description: 'Nije moguće povezati se sa serverom. Pokušajte ponovo.',
      });
    } finally {
      setIsLoading(false);
    }
  };

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
            <CardTitle className="text-2xl">Prijava</CardTitle>
            <CardDescription>Unesite vaše IPTV kredencijale za pristup</CardDescription>
          </CardHeader>

          <CardContent>
            {!serverConfigured && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  IPTV server nije konfigurisan. Administrator treba da podesi{' '}
                  <code className="rounded bg-secondary px-1 text-xs">VITE_XTREAM_SERVER</code> u
                  environment varijablama.
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Korisničko ime</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Unesite korisničko ime"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Lozinka</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Unesite lozinku"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    disabled={isLoading}
                  >
                    <span className="sr-only">{showPassword ? 'Sakrij lozinku' : 'Prikaži lozinku'}</span>
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !serverConfigured}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Prijava u toku...
                  </>
                ) : (
                  'Prijavi se'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Login;
