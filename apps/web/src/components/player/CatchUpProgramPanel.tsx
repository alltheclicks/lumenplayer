import type { Program } from '@lumen/types';
import { formatTime } from '@lumen/core';
import {
  Calendar,
  ChevronDown,
  Clock,
  Play,
  Radio,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

interface CatchUpProgramPanelProps {
  className: string;
  selectedProgram: Program | null;
  programsByDate: ReadonlyMap<string, readonly Program[]>;
  sortedDates: readonly string[];
  openDays: readonly string[];
  emptyStateReason: {
    title: string;
    description: string;
  };
  onClose: () => void;
  onGoLive: () => void;
  onSelectProgram: (program: Program) => void;
  onToggleDay: (dateKey: string) => void;
}

const formatFullDate = (date: Date): string => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Danas';
  if (date.toDateString() === yesterday.toDateString()) return 'Juče';

  return date.toLocaleDateString('sr-Latn-RS', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
};

export const CatchUpProgramPanel = ({
  className,
  selectedProgram,
  programsByDate,
  sortedDates,
  openDays,
  emptyStateReason,
  onClose,
  onGoLive,
  onSelectProgram,
  onToggleDay,
}: CatchUpProgramPanelProps) => (
  <div className={className} onClick={(event) => event.stopPropagation()}>
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 p-4">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold">Gledanje unazad</h3>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Zatvori TV unazad"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {selectedProgram && (
        <div className="border-b border-border/50 p-3">
          <Button className="w-full gap-2" variant="default" onClick={onGoLive}>
            <Radio className="h-4 w-4" />
            Vrati se na UŽIVO
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {sortedDates.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Clock className="mx-auto mb-2 h-12 w-12 opacity-50" />
              <p className="font-medium">{emptyStateReason.title}</p>
              <p className="mt-1 text-xs text-muted-foreground/90">
                {emptyStateReason.description}
              </p>
            </div>
          ) : (
            sortedDates.map((dateKey) => {
              const programs = programsByDate.get(dateKey) ?? [];
              const isOpen = openDays.includes(dateKey);

              return (
                <Collapsible
                  key={dateKey}
                  open={isOpen}
                  onOpenChange={() => onToggleDay(dateKey)}
                >
                  <CollapsibleTrigger className="w-full">
                    <div className="flex items-center justify-between rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {formatFullDate(new Date(dateKey))}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {programs.length} emisija
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-1 space-y-1">
                      {programs.map((program) => (
                        <button
                          key={program.id}
                          data-testid="catchup-program"
                          onClick={() => onSelectProgram(program)}
                          className={`w-full rounded-lg p-3 text-left transition-colors ${
                            selectedProgram?.id === program.id
                              ? 'border border-primary/50 bg-primary/20'
                              : 'bg-secondary/30 hover:bg-secondary/60'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                              {formatTime(program.startTime)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{program.title}</p>
                              {program.description && (
                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                  {program.description}
                                </p>
                              )}
                            </div>
                            <Play className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  </div>
);
