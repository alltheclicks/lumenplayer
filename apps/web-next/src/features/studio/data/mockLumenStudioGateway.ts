import { generateEPG } from '@lumen/demo-data';
import { formatTime, getCurrentProgram, getProgramProgress } from '@lumen/core';
import type { Channel } from '@lumen/types';
import type {
  CatalogDataset,
  CatalogKind,
  ChannelProgramRow,
  LiveShellSnapshot,
  LumenStudioGateway,
  StudioOverview,
} from '@/features/studio/data/lumenStudioGateway';

const liveChannelSeed = [
  {
    id: 'rts-1',
    number: 1,
    name: 'RTS 1',
    logo: '📺',
    category: 'Nacionalne',
    hasCatchUp: true,
    isFavorite: true,
    programs: ['Bolji zivot', 'Jutarnji program', 'Dnevnik', 'Slagalica'],
  },
  {
    id: 'rts-2',
    number: 2,
    name: 'RTS 2',
    logo: '📺',
    category: 'Nacionalne',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Moj rodjak sa sela', 'Kulturni dnevnik', 'TV kalendar', 'Koncert'],
  },
  {
    id: 'hrt-1',
    number: 3,
    name: 'HRT 1',
    logo: '🇭🇷',
    category: 'Nacionalne',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Sportski zurnal', 'Otvoreno', 'Dnevnik', 'Dokumentarac'],
  },
  {
    id: 'hrt-2',
    number: 4,
    name: 'HRT 2',
    logo: '🇭🇷',
    category: 'Nacionalne',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Beogradska hronika', 'Film veceri', 'Studio 4', 'HRT Sport'],
  },
  {
    id: 'rtrs',
    number: 5,
    name: 'RTRS',
    logo: '🇧🇦',
    category: 'Vesti',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Beogradska hronika', 'Dnevnik plus', 'Hronika regiona', 'Intervju'],
  },
  {
    id: 'bn-tv',
    number: 6,
    name: 'BN TV',
    logo: '🛰️',
    category: 'Zabava',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Kulturni dnevnik', 'Kviz dana', 'Puls grada', 'Talk show'],
  },
  {
    id: 'pink',
    number: 7,
    name: 'Pink',
    logo: '💗',
    category: 'Zabava',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Dnevnik 2', 'Zadruga pregled', 'Premijera vikend', 'Ami G show'],
  },
  {
    id: 'prva',
    number: 8,
    name: 'Prva',
    logo: '1️⃣',
    category: 'Zabava',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Jutro', 'MasterChef', 'Exploziv', '150 minuta'],
  },
  {
    id: 'happy-tv',
    number: 9,
    name: 'Happy TV',
    logo: '😊',
    category: 'Zabava',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Selo gori', 'Dobro jutro Srbijo', 'Aktuelnosti', 'Parovi'],
  },
  {
    id: 'b92',
    number: 10,
    name: 'B92',
    logo: '🗂️',
    category: 'Vesti',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Kvadratura kruga', 'Vesti B92', 'Fokus', 'Specijal'],
  },
  {
    id: 'arena-1',
    number: 11,
    name: 'Arena Sport 1',
    logo: '⚽',
    category: 'Sport',
    hasCatchUp: true,
    isFavorite: true,
    programs: ['Liga sampiona', 'Arena studio', 'Serie A', 'NBA pregled'],
  },
  {
    id: 'sk-1',
    number: 12,
    name: 'Sport Klub 1',
    logo: '🏁',
    category: 'Sport',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Euroliga', 'SK studio', 'Formula 1', 'Premier League'],
  },
  {
    id: 'nat-geo',
    number: 13,
    name: 'National Geographic',
    logo: '🟨',
    category: 'Dokumentarni',
    hasCatchUp: true,
    isFavorite: false,
    programs: ['Air Crash Investigation', 'Megafactories', 'Drain the Oceans', 'Explorer'],
  },
  {
    id: 'nick-jr',
    number: 14,
    name: 'Nick Jr',
    logo: '🧸',
    category: 'Deciji',
    hasCatchUp: false,
    isFavorite: false,
    programs: ['Paw Patrol', 'Peppa Pig', 'Dora', 'Blaze'],
  },
];

const liveChannels: Channel[] = liveChannelSeed.map((channel) => ({
  id: channel.id,
  number: channel.number,
  name: channel.name,
  logo: channel.logo,
  category: channel.category,
  hasCatchUp: channel.hasCatchUp,
  isFavorite: channel.isFavorite,
  epg: generateEPG(channel.id, channel.programs, channel.hasCatchUp),
}));

const moviesDataset: CatalogDataset = {
  kind: 'movies',
  title: 'Filmovi',
  searchPlaceholder: 'Pretrazi filmove...',
  countLabel: '12 filmova',
  categories: [
    { id: 'all', label: 'Svi filmovi' },
    { id: 'action', label: 'Akcija' },
    { id: 'comedy', label: 'Komedija' },
    { id: 'drama', label: 'Drama' },
    { id: 'thriller', label: 'Triler' },
    { id: 'sci-fi', label: 'Naucna fantastika' },
    { id: 'horror', label: 'Horor' },
    { id: 'romance', label: 'Romantika' },
    { id: 'animated', label: 'Animirani' },
    { id: 'documentary', label: 'Dokumentarni' },
  ],
  items: [
    { id: 'movie-1', title: 'Poslednji Heroj', categoryId: 'action', yearLabel: '2024', durationLabel: '2h 22min', ratingLabel: '8.2', summary: 'Akcija sa OTT card ritmom kao u postojecem Lumen gridu.', gradientClassName: 'from-blue-500 to-violet-500', genreLabels: ['Akcija', 'Triler'] },
    { id: 'movie-2', title: 'Ljubav u Beogradu', categoryId: 'romance', yearLabel: '2023', durationLabel: '1h 58min', ratingLabel: '7.5', summary: 'Romanticna komedija za proveru duzih naslova u gridu.', gradientClassName: 'from-emerald-500 to-teal-400', genreLabels: ['Romantika', 'Komedija'] },
    { id: 'movie-3', title: 'Mrak', categoryId: 'thriller', yearLabel: '2024', durationLabel: '1h 38min', ratingLabel: '7.8', summary: 'Tamni tonalitet i kratki genre badges kao u aktuelnom UI-ju.', gradientClassName: 'from-amber-500 to-orange-500', genreLabels: ['Horor', 'Triler'] },
    { id: 'movie-4', title: 'Galaksija 7', categoryId: 'sci-fi', yearLabel: '2024', durationLabel: '2h 36min', ratingLabel: '8.5', summary: 'Sci-fi naslov za proveru zasicenijih poster fallback boja.', gradientClassName: 'from-violet-500 to-pink-500', genreLabels: ['Naucna fantastika', 'Avantura'] },
    { id: 'movie-5', title: 'Smeh do Suza', categoryId: 'comedy', yearLabel: '2023', durationLabel: '1h 45min', ratingLabel: '7.2', summary: 'Laksi tonalitet i citljivost na jarkim posterima.', gradientClassName: 'from-sky-500 to-blue-500', genreLabels: ['Komedija'] },
    { id: 'movie-6', title: 'Senke Proslosti', categoryId: 'drama', yearLabel: '2024', durationLabel: '2h 15min', ratingLabel: '8.0', summary: 'Dramatican card sa istim footer rasporedom kao postojece kartice.', gradientClassName: 'from-emerald-500 to-green-500', genreLabels: ['Drama', 'Misterija'] },
    { id: 'movie-7', title: 'Robot i Decak', categoryId: 'animated', yearLabel: '2024', durationLabel: '1h 42min', ratingLabel: '8.8', summary: 'Animirani naslov za family-focused raspored tagova.', gradientClassName: 'from-amber-400 to-orange-500', genreLabels: ['Animirani', 'Porodicni'] },
    { id: 'movie-8', title: 'Bitka za Slobodu', categoryId: 'action', yearLabel: '2023', durationLabel: '2h 03min', ratingLabel: '8.3', summary: 'Akcioni naslov sa gušćim metapodacima u donjem panelu.', gradientClassName: 'from-red-500 to-orange-500', genreLabels: ['Akcija', 'Drama'] },
    { id: 'movie-9', title: 'Nocni Let', categoryId: 'thriller', yearLabel: '2024', durationLabel: '1h 52min', ratingLabel: '7.6', summary: 'Triler za proveru kako izgleda card grid u punoj gustini.', gradientClassName: 'from-blue-500 to-violet-500', genreLabels: ['Triler', 'Misterija'] },
    { id: 'movie-10', title: 'Priroda Divljine', categoryId: 'documentary', yearLabel: '2024', durationLabel: '1h 31min', ratingLabel: '8.1', summary: 'Dokumentarni naslov za smireniji, neutralniji metadata blok.', gradientClassName: 'from-emerald-500 to-teal-400', genreLabels: ['Dokumentarni'] },
    { id: 'movie-11', title: 'Porodicno Blago', categoryId: 'comedy', yearLabel: '2023', durationLabel: '1h 49min', ratingLabel: '7.4', summary: 'Komedija za test duzih naslova i vise genre pill-ova.', gradientClassName: 'from-yellow-400 to-orange-500', genreLabels: ['Komedija', 'Porodicni'] },
    { id: 'movie-12', title: 'Crna Voda', categoryId: 'drama', yearLabel: '2024', durationLabel: '2h 10min', ratingLabel: '8.4', summary: 'Finalni grid card za proveru wrapping-a i ravnoteze poster boja.', gradientClassName: 'from-violet-500 to-pink-500', genreLabels: ['Drama', 'Triler'] },
  ],
};

const seriesDataset: CatalogDataset = {
  kind: 'series',
  title: 'Serije',
  searchPlaceholder: 'Pretrazi serije...',
  countLabel: '12 serija',
  categories: [
    { id: 'all', label: 'Sve serije' },
    { id: 'crime', label: 'Krimi' },
    { id: 'drama', label: 'Drama' },
    { id: 'comedy', label: 'Komedija' },
    { id: 'thriller', label: 'Triler' },
    { id: 'history', label: 'Istorijske' },
    { id: 'fantasy', label: 'Fantazija' },
  ],
  items: [
    { id: 'series-1', title: 'Podzemlje', categoryId: 'crime', yearLabel: '2022-', durationLabel: 'S2  16 ep.', ratingLabel: '8.7', summary: 'Krimi serija za proveru metadata ritma i status badge-a.', gradientClassName: 'from-blue-500 to-violet-500', genreLabels: ['Krimi', 'Drama'], statusLabel: 'Nova sezona' },
    { id: 'series-2', title: 'Beogradske Price', categoryId: 'drama', yearLabel: '2021-', durationLabel: 'S4  42 ep.', ratingLabel: '7.9', summary: 'Duga forma za proveru naziva, statusa i gustoce card footer-a.', gradientClassName: 'from-emerald-500 to-teal-400', genreLabels: ['Drama', 'Romansa'], statusLabel: 'Aktivna' },
    { id: 'series-3', title: 'Mesto Zlocina', categoryId: 'crime', yearLabel: '2024-', durationLabel: 'S1  8 ep.', ratingLabel: '8.3', summary: 'Kraca sezona za heroicniji title treatment.', gradientClassName: 'from-amber-500 to-orange-500', genreLabels: ['Krimi', 'Triler'], statusLabel: 'Novo' },
    { id: 'series-4', title: 'Galeb', categoryId: 'drama', yearLabel: '2020-2024', durationLabel: '4 sezone', ratingLabel: '8.5', summary: 'Zavrsena serija za proveru alternative green vs indigo badge logike.', gradientClassName: 'from-violet-500 to-pink-500', genreLabels: ['Drama'], statusLabel: 'Zavrseno' },
    { id: 'series-5', title: 'Humoristi', categoryId: 'comedy', yearLabel: '2023-', durationLabel: 'S2  20 ep.', ratingLabel: '7.4', summary: 'Komedija za laksi card ton i manje dramatican info blok.', gradientClassName: 'from-sky-500 to-blue-500', genreLabels: ['Komedija'], statusLabel: 'Aktivna' },
    { id: 'series-6', title: 'Krunisanje', categoryId: 'history', yearLabel: '2021-', durationLabel: 'S3  24 ep.', ratingLabel: '8.1', summary: 'Istorijska serija kao test za duze opise i badge ravnotezu.', gradientClassName: 'from-emerald-500 to-green-500', genreLabels: ['Istorijska', 'Drama'], statusLabel: 'Aktivna' },
    { id: 'series-7', title: 'Poslednja Smena', categoryId: 'thriller', yearLabel: '2024-', durationLabel: 'S1  10 ep.', ratingLabel: '8.6', summary: 'Napeti vizuelni smer za proveru tamnijeg card footer odnosa.', gradientClassName: 'from-red-500 to-orange-500', genreLabels: ['Triler', 'Drama'], statusLabel: 'Novo' },
    { id: 'series-8', title: 'Detektiv Marko', categoryId: 'crime', yearLabel: '2023-', durationLabel: 'S2  18 ep.', ratingLabel: '8.0', summary: 'Krimi baseline slican trenutnom Lumen katalog osećaju.', gradientClassName: 'from-yellow-400 to-orange-500', genreLabels: ['Krimi'], statusLabel: 'Aktivna' },
    { id: 'series-9', title: 'Tajne Dunava', categoryId: 'fantasy', yearLabel: '2022-', durationLabel: 'S3  26 ep.', ratingLabel: '8.2', summary: 'Fantazija za proveru saturisanijih fallback tonova.', gradientClassName: 'from-blue-500 to-violet-500', genreLabels: ['Fantazija', 'Avantura'], statusLabel: 'Aktivna' },
    { id: 'series-10', title: 'Nasa Mala Firma', categoryId: 'comedy', yearLabel: '2019-2023', durationLabel: '5 sezona', ratingLabel: '7.8', summary: 'Zavrsena komedija za duze trajectory metadata.', gradientClassName: 'from-emerald-500 to-teal-400', genreLabels: ['Komedija'], statusLabel: 'Zavrseno' },
    { id: 'series-11', title: 'Korak Ispred', categoryId: 'thriller', yearLabel: '2024-', durationLabel: 'S1  12 ep.', ratingLabel: '8.4', summary: 'Brza, moderna serija za novu card ritmiku u gridu.', gradientClassName: 'from-violet-500 to-pink-500', genreLabels: ['Triler', 'Akcija'], statusLabel: 'Novo' },
    { id: 'series-12', title: 'Secanja', categoryId: 'drama', yearLabel: '2020-', durationLabel: 'S4  40 ep.', ratingLabel: '7.7', summary: 'Drama za proveru citljivosti kada ima vise badge elemenata.', gradientClassName: 'from-sky-500 to-blue-500', genreLabels: ['Drama'], statusLabel: 'Aktivna' },
  ],
};

const overview: StudioOverview = {
  headline: 'Lumen Next Studio',
  summary: 'Paralelni UI sandbox za novi shell, player surface i kataloge. Radi u odvojenom worktree-ju i ne menja postojeci apps/web dok ne odlucis sta vredi preneti.',
  designPrinciples: [
    'web-next sada prati postojeci Lumen baseline po izgledu i rutama, ali i dalje koristi mock/adapters sloj.',
    'Eksperimenti se rade u apps/web-next, a merge u produkcioni apps/web ide ekran po ekran.',
    'Svaki agent dobija uski write scope da bi paralelan rad ostao bez merge konflikata.',
  ],
  guardrails: [
    'Ne dirati apps/web iz ui-next taska osim ako je merge faza eksplicitno otvorena.',
    'Ne menjati streaming, session restore ili Xtream servis logiku radi UI eksperimenta.',
    'Svaki veci UI task mora da ostavi lint, typecheck i build zelenim u apps/web-next.',
  ],
  commands: [
    'pnpm install',
    'pnpm --filter @lumen/web-next dev',
    'pnpm --filter @lumen/web-next lint',
    'pnpm --filter @lumen/web-next typecheck',
    'pnpm --filter @lumen/web-next build',
  ],
  lanes: [
    {
      title: 'Shell System',
      route: '/player',
      ownerHint: 'Agent ili osoba zaduzeni za navigation, spacing i token sistem.',
      objective: 'Odrzavati Lumen shell baseline i menjati ga postepeno, ne iz nule.',
      deliverable: 'Stabilan shared layout i token set koji ne zavisi od player business logike.',
    },
    {
      title: 'Live Shell',
      route: '/player',
      ownerHint: 'Agent fokusiran na channel rail, hero i player context bez playback integracije.',
      objective: 'Raditi na live shell-u koji vec izgleda kao trenutni Lumen, pa ga iterirati.',
      deliverable: 'Jasan live browsing UX sa mock gateway podacima i istom baznom kompozicijom.',
    },
    {
      title: 'Catalog Pages',
      route: '/vod',
      ownerHint: 'Agent fokusiran na VOD/Series listing, detail card ritam i metadata hijerarhiju.',
      objective: 'Iterirati VOD i Series stranice od postojeceg Lumen izgleda, ne od koncepta.',
      deliverable: 'Ponovo upotrebljiv katalog sistem spreman za postepeni prenos u glavni app.',
    },
    {
      title: 'Merge Plan',
      route: '/studio/merge-plan',
      ownerHint: 'Agent koji prati kako se eksperimentalni UI deli na male PR-ove.',
      objective: 'Odrzati jasan put od eksperimenta do bezbednog merge-a u main.',
      deliverable: 'Fazni plan sa granicama sta sme, a sta ne sme da ide u produkcioni app.',
    },
  ],
  mergePhases: [
    'Faza 1: shared tokens, typography, spacing i layout primitives.',
    'Faza 2: jedan izolovan ekran, po pravilu login ili VOD listing, bez player zahvata.',
    'Faza 3: live shell bez promene playback engine-a.',
    'Faza 4: detalji, animacije, empty/loading/error states i polish.',
  ],
};

const toLiveCard = (channel: Channel) => {
  const currentProgram = getCurrentProgram(channel) ?? channel.epg[0];
  const currentIndex = currentProgram
    ? channel.epg.findIndex((program) => program.id === currentProgram.id)
    : -1;
  const nextProgram = currentIndex >= 0 ? channel.epg[currentIndex + 1] : undefined;
  const programs: ChannelProgramRow[] = [
    {
      id: `${channel.id}-now`,
      title: currentProgram?.title ?? 'Bez aktuelnog programa',
      timeLabel: currentProgram
        ? `${formatTime(currentProgram.startTime)} - ${formatTime(currentProgram.endTime)}`
        : 'Bez satnice',
      badge: 'UŽIVO',
      progressPercent: currentProgram ? Math.round(getProgramProgress(currentProgram)) : 0,
    },
    {
      id: `${channel.id}-next`,
      title: nextProgram?.title ?? 'Program uskoro',
      timeLabel: nextProgram
        ? `${formatTime(nextProgram.startTime)} - ${formatTime(nextProgram.endTime)}`
        : 'Sledeci termin',
      badge: 'SLEDI',
    },
    ...channel.epg.slice(Math.max(currentIndex + 2, 0), Math.max(currentIndex + 4, 0)).map((program) => ({
      id: program.id,
      title: program.title,
      timeLabel: `${formatTime(program.startTime)} - ${formatTime(program.endTime)}`,
    })),
  ];

  return {
    id: channel.id,
    number: channel.number,
    name: channel.name,
    logo: channel.logo,
    categoryId: channel.category.toLowerCase().replace(/\s+/g, '-'),
    categoryLabel: channel.category,
    subtitle: currentProgram?.title ?? channel.category,
    hasCatchUp: channel.hasCatchUp,
    isFavorite: channel.isFavorite,
    programs,
  };
};

export const mockLumenStudioGateway: LumenStudioGateway = {
  async getOverview() {
    return overview;
  },
  async getLiveShellSnapshot() {
    const cards = liveChannels.map(toLiveCard);
    const categories = [
      {
        id: 'all',
        label: 'Svi kanali',
        count: liveChannels.length,
        tone: 'accent' as const,
      },
      {
        id: 'favorites',
        label: 'Omiljeni',
        count: liveChannels.filter((channel) => channel.isFavorite).length,
      },
      ...Array.from(new Set(liveChannels.map((channel) => channel.category))).map((category) => ({
        id: category.toLowerCase().replace(/\s+/g, '-'),
        label: category,
        count: liveChannels.filter((channel) => channel.category === category).length,
      })),
    ];

    const snapshot: LiveShellSnapshot = {
      categories,
      channels: cards,
      selectedChannelId: cards[0]?.id ?? '',
      alertTitle: 'Problem sa konekcijom',
      alertMessage: 'Demo rezim je aktivan. Za gledanje uzivo, podesi pravi IPTV server u settings toku.',
      accountLabel: 'Demo nalog',
      accountMeta: 'Sandbox baseline bez backend spajanja',
    };

    return snapshot;
  },
  async getCatalogDataset(kind: CatalogKind) {
    return kind === 'movies' ? moviesDataset : seriesDataset;
  },
};
