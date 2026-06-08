import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatErrorBoundaryMessage } from './errorBoundaryMessage';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional hook for surfacing the error to logging/observability. */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /** Optional custom fallback renderer. */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: unknown;
}

/**
 * Top-level React error boundary so a render crash in any route shows a
 * recoverable fallback instead of a blank white screen. (M1.2-a, MVP exit #5)
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (this.props.onError) {
      this.props.onError(error, info);
      return;
    }
    // Default: keep the crash visible in the console for debugging.
    console.error('Uncaught error in React tree:', error, info);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div
        role="alert"
        className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 bg-background p-6 text-center"
      >
        <div className="space-y-2">
          <h1 className="text-lg font-semibold text-foreground">Nešto je pošlo po zlu</h1>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            {formatErrorBoundaryMessage(error)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={this.reset}>Pokušaj ponovo</Button>
          <Button variant="outline" onClick={() => window.location.assign('/player')}>
            Nazad na početak
          </Button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
