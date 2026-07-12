import { useState } from 'react';
import { MessageSquareWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { submitPlayerFeedback, emitPlayerAnalyticsEvent } from '@/services/playerAnalytics';

const FEEDBACK_CATEGORIES = [
  ['channel_not_working', 'Kanal ne radi'],
  ['buffering', 'Secka ili se dugo učitava'],
  ['no_audio', 'Nema zvuka'],
  ['av_sync', 'Slika i zvuk nisu sinhronizovani'],
  ['catchup_not_working', 'TV unazad ne radi'],
  ['wrong_epg', 'Pogrešan program / EPG'],
  ['interface', 'Problem sa komandama ili interfejsom'],
  ['suggestion', 'Predlog'],
  ['other', 'Drugo'],
] as const;

const PlayerFeedbackButton = () => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(FEEDBACK_CATEGORIES[0][0]);
  const [message, setMessage] = useState('');
  const [score, setScore] = useState<number | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setResult(null);
      emitPlayerAnalyticsEvent('feedback.opened', 'info', {
        interactionTarget: 'feedback.open',
      });
    } else if (!result) {
      emitPlayerAnalyticsEvent('feedback.cancelled', 'info', {
        interactionTarget: 'feedback.cancel',
      });
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setResult(null);
    const ok = await submitPlayerFeedback({
      category,
      message,
      experienceScore: score,
    });
    setSubmitting(false);
    setResult(ok ? 'success' : 'error');
    if (ok) {
      setMessage('');
      window.setTimeout(() => setOpen(false), 1_200);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] right-3 z-40 gap-2 rounded-full border border-border/70 bg-card/95 shadow-lg backdrop-blur-md md:bottom-5 md:right-5"
        onClick={() => setOpen(true)}
        data-analytics-id="feedback.open"
      >
        <MessageSquareWarning className="h-4 w-4" />
        <span className="hidden sm:inline">Prijavi problem</span>
        <span className="sm:hidden">Problem?</span>
      </Button>

      <AlertDialog open={open} onOpenChange={handleOpenChange}>
        <AlertDialogContent className="max-h-[90svh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Prijavi problem</AlertDialogTitle>
            <AlertDialogDescription>
              Player je u beta verziji. Uz prijavu šaljemo bezbedne tehničke podatke i kratku
              dijagnostiku neposredno pre problema, bez video-snimka programa i bez lozinke.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 text-left">
            <div className="space-y-2">
              <Label htmlFor="player-feedback-category">Šta nije u redu?</Label>
              <select
                id="player-feedback-category"
                value={category}
                onChange={(event) => setCategory(event.target.value as typeof category)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                data-analytics-id="feedback.category"
              >
                {FEEDBACK_CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="player-feedback-message">Opiši problem ili predlog</Label>
              <textarea
                id="player-feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                maxLength={10_000}
                placeholder="Na primer: kanal se zaustavio posle nekoliko minuta..."
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-analytics-id="feedback.message"
              />
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Ocena iskustva (opciono)</legend>
              <div className="flex gap-2" role="radiogroup" aria-label="Ocena iskustva">
                {[1, 2, 3, 4, 5].map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={score === value ? 'default' : 'outline'}
                    onClick={() => setScore(value)}
                    aria-pressed={score === value}
                    data-analytics-id={`feedback.score.${value}`}
                  >
                    {value}
                  </Button>
                ))}
              </div>
            </fieldset>

            {result === 'success' && (
              <p role="status" className="text-sm font-medium text-success">
                Hvala — prijava je poslata.
              </p>
            )}
            {result === 'error' && (
              <p role="alert" className="text-sm font-medium text-destructive">
                Prijava je sačuvana za ponovni pokušaj kada veza bude dostupna.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Otkaži</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || result === 'success'}
              data-analytics-id="feedback.submit"
            >
              {submitting ? 'Šaljem...' : 'Pošalji prijavu'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PlayerFeedbackButton;
