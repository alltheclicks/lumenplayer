import { useState } from 'react';
import { MessageSquareWarning, Sparkles } from 'lucide-react';
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
import {
  submitPlayerFeedback,
  emitPlayerAnalyticsEvent,
  getPlayerFeedbackSuggestion,
} from '@/services/playerAnalytics';
import type {
  PlayerFeedbackCategory,
  PlayerFeedbackSuggestion,
} from '@/services/playerFeedbackSuggestion';

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
] as const satisfies ReadonlyArray<readonly [PlayerFeedbackCategory, string]>;

const FEEDBACK_PLACEHOLDERS: Record<PlayerFeedbackCategory, string> = {
  channel_not_working: 'Na primer: kanal ostaje na učitavanju ili prikazuje grešku...',
  buffering: 'Na primer: slika zastaje na svakih nekoliko sekundi...',
  no_audio: 'Na primer: slika radi, ali se zvuk ne čuje...',
  av_sync: 'Na primer: zvuk kasni za slikom nekoliko sekundi...',
  catchup_not_working: 'Na primer: emisija od juče se ne pokreće...',
  wrong_epg: 'Na primer: prikazuje se pogrešna emisija ili vreme...',
  interface: 'Na primer: dugme ili komanda ne reaguje...',
  suggestion: 'Napiši kako bismo mogli da poboljšamo player...',
  other: 'Ukratko opiši šta se dogodilo...',
};

const PlayerFeedbackButton = () => {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<PlayerFeedbackCategory>(FEEDBACK_CATEGORIES[0][0]);
  const [suggestion, setSuggestion] = useState<PlayerFeedbackSuggestion | null>(null);
  const [message, setMessage] = useState('');
  const [score, setScore] = useState<number | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setResult(null);
      const detectedSuggestion = getPlayerFeedbackSuggestion();
      setSuggestion(detectedSuggestion);
      if (detectedSuggestion) setCategory(detectedSuggestion.category);
      emitPlayerAnalyticsEvent('feedback.opened', 'info', {
        interactionTarget: 'feedback.open',
        suggestedCategory: detectedSuggestion?.category,
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
            {suggestion && (
              <button
                type="button"
                onClick={() => setCategory(suggestion.category)}
                className="w-full rounded-lg border border-primary/40 bg-primary/10 p-3 text-left transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-analytics-id="feedback.suggestion"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Player predlaže
                </span>
                <span className="mt-1 block text-sm font-medium text-foreground">
                  {suggestion.title}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {suggestion.description}
                </span>
              </button>
            )}

            <div className="space-y-2">
              <Label>Šta nije u redu?</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Vrsta problema">
                {FEEDBACK_CATEGORIES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={category === value}
                    onClick={() => setCategory(value)}
                    className={`min-h-11 rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      category === value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-background text-foreground hover:bg-accent'
                    }`}
                    data-analytics-id={`feedback.category.${value}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="player-feedback-message">Opiši problem ili predlog</Label>
              <textarea
                id="player-feedback-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={4}
                maxLength={10_000}
                placeholder={FEEDBACK_PLACEHOLDERS[category]}
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
