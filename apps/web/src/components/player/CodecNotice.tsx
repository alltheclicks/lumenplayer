import { useState } from 'react';
import { Info, VolumeX, X } from 'lucide-react';

interface CodecNoticeProps {
  kind: 'audio' | 'video';
}

/** A source-scoped notice: dismissing the explanation keeps its status visible. */
export const CodecNotice = ({ kind }: CodecNoticeProps) => {
  const [expanded, setExpanded] = useState(true);
  const audio = kind === 'audio';
  const Icon = audio ? VolumeX : Info;
  const label = audio ? 'Bez zvuka' : 'Format slike';

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-30 flex justify-center sm:inset-x-4 sm:top-4">
      {expanded ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-amber-300/25 bg-slate-950/95 p-3 text-left text-white shadow-xl backdrop-blur-md sm:p-4"
        >
          <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-5">
              {audio ? 'Trenutno bez zvuka' : 'Format slike nije podržan na svim uređajima'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:text-sm">
              {audio
                ? 'Dobavljač šalje zvuk u MP2 formatu, koji web player trenutno ne podržava. Možete nastaviti da gledate sliku.'
                : 'Dobavljač šalje sliku u HEVC (H.265) formatu. Ako nema slike, izaberite HD ili SD verziju kanala, ako je dostupna.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
            aria-label="Sklopi obaveštenje"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label={`${label} — prikaži objašnjenje`}
          className="pointer-events-auto flex min-h-11 items-center gap-2 rounded-full border border-amber-300/25 bg-slate-950/90 px-4 text-xs font-medium text-amber-200 shadow-lg backdrop-blur-md hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
        </button>
      )}
    </div>
  );
};
