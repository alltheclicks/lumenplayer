import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, Cable, Layers3, ShieldCheck } from 'lucide-react';
import { useStudioOverview } from '@/features/studio/hooks/useStudioData';

const StudioHomePage = () => {
  const { data } = useStudioOverview();

  if (!data) {
    return null;
  }

  return (
    <>
      <Helmet>
        <title>Lumen Next Studio</title>
      </Helmet>

      <section className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <article className="rounded-3xl border border-border bg-card p-6 md:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs uppercase tracking-[0.26em] text-muted-foreground">
              <Layers3 className="h-3.5 w-3.5" />
              Design brief
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
              {data.headline}
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
              {data.summary}
            </p>

            <div className="mt-8 grid gap-3 md:grid-cols-3">
              <div className="rounded-3xl border border-border bg-secondary/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Parallel</div>
                <div className="mt-2 text-sm font-medium text-foreground">Odvojeni worktree i branch</div>
              </div>
              <div className="rounded-3xl border border-border bg-secondary/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Shared core</div>
                <div className="mt-2 text-sm font-medium text-foreground">Isti domen tipovi, mock-backed UI</div>
              </div>
              <div className="rounded-3xl border border-border bg-secondary/60 p-4">
                <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Baseline</div>
                <div className="mt-2 text-sm font-medium text-foreground">Kreće od postojećeg Lumen izgleda</div>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.26em] text-muted-foreground">
              <Cable className="h-4 w-4" />
              Commands
            </div>
            <div className="mt-4 space-y-3">
              {data.commands.map((command) => (
                <div
                  key={command}
                  className="rounded-2xl border border-border bg-background px-4 py-3 font-mono text-sm text-foreground"
                >
                  {command}
                </div>
              ))}
            </div>
          </article>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <article className="rounded-3xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.26em] text-muted-foreground">
              <ArrowUpRight className="h-4 w-4" />
              Active lanes
            </div>
            <div className="mt-4 grid gap-3">
              {data.lanes.map((lane) => (
                <a
                  key={lane.title}
                  href={lane.route}
                  className="rounded-[24px] border border-border bg-secondary/40 p-4 transition hover:border-primary/30 hover:bg-secondary"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-medium text-foreground">{lane.title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{lane.objective}</p>
                    </div>
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {lane.route}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{lane.ownerHint}</p>
                  <p className="mt-2 text-sm text-foreground">{lane.deliverable}</p>
                </a>
              ))}
            </div>
          </article>

          <article className="rounded-3xl border border-border bg-card p-6">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.26em] text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              Guardrails
            </div>
            <div className="mt-4 space-y-5">
              <div>
                <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Design principles</h3>
                <ul className="mt-3 space-y-3 text-sm leading-6 text-foreground">
                  {data.designPrinciples.map((item) => (
                    <li key={item} className="rounded-2xl border border-border bg-secondary/40 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-sm uppercase tracking-[0.2em] text-muted-foreground">Do not break</h3>
                <ul className="mt-3 space-y-3 text-sm leading-6 text-foreground">
                  {data.guardrails.map((item) => (
                    <li key={item} className="rounded-2xl border border-border bg-secondary/40 px-4 py-3">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        </div>
      </section>
    </>
  );
};

export default StudioHomePage;
