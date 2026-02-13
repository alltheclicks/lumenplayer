import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Tv, AlertCircle, Info } from 'lucide-react';
import { XTREAM_SERVER_URL, isServerConfigured, getServerDisplayName } from '@/config/xtream';
import { xtreamCodesService, saveXtreamCredentials } from '@/services/xtreamCodes';

const Login = () => {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const serverConfigured = isServerConfigured();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    if (!serverConfigured) {
      setError('Server not configured. Check your .env file.');
      setIsLoading(false);
      return;
    }

    if (!username.trim() || !password.trim()) {
      setError('Please enter username and password.');
      setIsLoading(false);
      return;
    }

    try {
      const credentials = {
        server: XTREAM_SERVER_URL,
        username: username.trim(),
        password: password.trim(),
      };

      xtreamCodesService.setCredentials(credentials);
      const response = await xtreamCodesService.authenticate();

      if (response.user_info?.auth === 1) {
        await saveXtreamCredentials(credentials);
        navigate('/player');
      } else {
        setError('Invalid credentials. Please try again.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Login failed. Check your credentials and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    const demoCredentials = {
      server: 'http://demo.server.com',
      username: 'demo',
      password: 'demo',
    };
    await saveXtreamCredentials(demoCredentials);
    navigate('/player');
  };

  return (
    <>
      <Helmet>
        <title>Login - IPTV Player</title>
        <meta name="description" content="Login to watch live TV channels" />
      </Helmet>

      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Tv className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">IPTV Player</CardTitle>
            <CardDescription>
              Enter your credentials to watch TV
            </CardDescription>
          </CardHeader>

          <CardContent>
            {!serverConfigured && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Server not configured. Set VITE_XTREAM_SERVER in your .env file.
                </AlertDescription>
              </Alert>
            )}

            {serverConfigured && (
              <Alert className="mb-4">
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Server: {getServerDisplayName()}
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || !serverConfigured}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Logging in...
                  </>
                ) : (
                  'Login'
                )}
              </Button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    or
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  void handleDemoLogin();
                }}
              >
                Try Demo Mode
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
};

export default Login;
