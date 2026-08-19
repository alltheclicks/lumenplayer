import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Program } from '@lumen/types';
import { CatchUpProgramPanel } from './CatchUpProgramPanel';

const sharedProps = {
  className: 'test-panel',
  openDays: [],
  emptyStateReason: {
    title: 'Nema dostupnih snimaka',
    description: 'Pokušajte ponovo za nekoliko minuta.',
  },
  onClose: vi.fn(),
  onGoLive: vi.fn(),
  onSelectProgram: vi.fn(),
  onToggleDay: vi.fn(),
};

describe('CatchUpProgramPanel', () => {
  it('renders the provider-specific empty state', () => {
    const markup = renderToStaticMarkup(
      <CatchUpProgramPanel
        {...sharedProps}
        selectedProgram={null}
        programsByDate={new Map()}
        sortedDates={[]}
      />,
    );

    expect(markup).toContain('Gledanje unazad');
    expect(markup).toContain('Nema dostupnih snimaka');
    expect(markup).toContain('Pokušajte ponovo za nekoliko minuta.');
    expect(markup).not.toContain('Vrati se na UŽIVO');
  });

  it('renders the same selectable program content when catch-up is active', () => {
    const program: Program = {
      id: 'program-1',
      title: 'Večernje vesti',
      description: 'Pregled dana',
      startTime: new Date('2026-08-18T18:00:00+02:00'),
      endTime: new Date('2026-08-18T19:00:00+02:00'),
      category: 'Vesti',
      hasCatchUp: true,
    };
    const dateKey = program.startTime.toDateString();
    const markup = renderToStaticMarkup(
      <CatchUpProgramPanel
        {...sharedProps}
        selectedProgram={program}
        programsByDate={new Map([[dateKey, [program]]])}
        sortedDates={[dateKey]}
        openDays={[dateKey]}
      />,
    );

    expect(markup).toContain('Vrati se na UŽIVO');
    expect(markup).toContain('data-testid="catchup-program"');
    expect(markup).toContain('Večernje vesti');
    expect(markup).toContain('Pregled dana');
  });
});
