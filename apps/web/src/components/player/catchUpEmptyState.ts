import type { PlayerChannel } from '@lumen/types';

type CatchUpEmptyStateReason = {
  title: string;
  description: string;
};

type CatchUpChannelSnapshot = Pick<PlayerChannel, 'hasCatchUp' | 'catchUpDays' | 'epg'>;

export const resolveCatchUpEmptyStateReason = (
  channel: CatchUpChannelSnapshot,
  now = new Date(),
): CatchUpEmptyStateReason => {
  if (!channel.hasCatchUp || channel.catchUpDays <= 0) {
    return {
      title: 'TV Unazad nije podržan',
      description: 'Ovaj kanal ili paket ne podržava arhivu snimaka.',
    };
  }

  if (channel.epg.length === 0) {
    return {
      title: 'Nema EPG podataka',
      description: 'Nema programske šeme za ovaj kanal, pa snimci trenutno nisu dostupni.',
    };
  }

  const pastPrograms = channel.epg.filter((program) => program.endTime < now);
  if (pastPrograms.length === 0) {
    return {
      title: 'Još nema emisija za vraćanje',
      description: 'Sačekajte da se završi bar jedna emisija kako bi TV Unazad bio dostupan.',
    };
  }

  const archivedPrograms = pastPrograms.filter((program) => program.hasCatchUp);
  if (archivedPrograms.length === 0) {
    return {
      title: 'Snimci nisu dostupni',
      description: 'Program postoji u EPG-u, ali provajder nije vratio dostupne catch-up zapise.',
    };
  }

  return {
    title: 'Nema dostupnih snimaka',
    description: 'Pokušajte ponovo za nekoliko minuta.',
  };
};
