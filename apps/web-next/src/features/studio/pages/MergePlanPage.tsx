import { Helmet } from 'react-helmet-async';
import { GitMerge, ScanSearch, Workflow } from 'lucide-react';
import { useStudioOverview } from '@/features/studio/hooks/useStudioData';

const MergePlanPage = () => {
  const { data } = useStudioOverview();

  if (!data) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>Merge Plan</title>
      </Helmet>

      <section className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
            <Workflow className="h-4 w-4" />
            Merge phases
          </div>
          <div className="mt-4 space-y-3">
            {data.mergePhases.map((phase, index) => (
              <div key={phase} className="rounded-[24px] border border-border bg-secondary/40 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Phase {index + 1}</div>
                <div className="mt-2 text-sm leading-6 text-foreground">{phase}</div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-3xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
            <ScanSearch className="h-4 w-4" />
            Review checklist
          </div>
          <div className="mt-4 grid gap-3">
            {data.guardrails.map((item) => (
              <div key={item} className="rounded-[24px] border border-border bg-secondary/40 p-4 text-sm leading-6 text-foreground">
                {item}
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-3xl border border-border bg-card p-6 lg:col-span-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">
            <GitMerge className="h-4 w-4" />
            Recommended operating model
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-[24px] border border-border bg-secondary/40 p-5">
              <h3 className="text-lg font-medium text-foreground">Parallel task split</h3>
              <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>`shared/layout` i tokeni idu jednom agentu.</p>
                <p>`/player` browsing i player shell ritam idu drugom agentu.</p>
                <p>`/vod` i `/series` listing ritam idu trecem agentu.</p>
                <p>Adapteri ka realnim podacima ulaze tek kada se UX smer stabilizuje.</p>
              </div>
            </div>

            <div className="rounded-[24px] border border-border bg-secondary/40 p-5">
              <h3 className="text-lg font-medium text-foreground">Promotion to main</h3>
              <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                <p>Ne merge-ovati `apps/web-next` u `apps/web` kao veliki refactor.</p>
                <p>Izvuci proverene primitives i presadi ih u male, pregledne PR-ove.</p>
                <p>Svaki PR mora da potvrdi da nije dirao playback engine osim ako je to eksplicitni cilj.</p>
                <p>Eksperimentalni kod koji nije usvojen ostaje u sandbox branchu, ne ide u `main` iz inercije.</p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </>
  );
};

export default MergePlanPage;
