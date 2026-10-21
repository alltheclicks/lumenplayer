# TV-003 — zajednički source, catalog i playback ugovor

Datum implementacije: 2026-10-21. Baza: `ebb93acd6aaace2202b305a15a655b7f06ac32c5`.
Ugovor je dodat u postojeće portable pakete; nijedan TV shell ili platform adapter
još nije integrisan. Ovo nije playback ili uređaj-verifikacija.

## Šta postoji

- `@lumen/types` izvozi `TV_CONTRACT_VERSION` i tipove `TVSourceDescriptor`,
  `TVCatalogSnapshot`, `TVEpgEntry`, live/catch-up requeste i
  `TVPlaybackAdapter`/capability/snapshot tipove.
- `TVCatalogSnapshot` zadržava postojeće `PlayerChannel`, `PlayerCategory` i
  `Program` polja. EPG je normalizovan u `TVEpgEntry`, koji čuva sva `Program`
  polja osim `Date` vrednosti `startTime`/`endTime`; zamenjuju ih Unix epoch
  milisekunde `startTimeMs`/`endTimeMs`. `fetchedAtMs` je takođe u milisekundama.
  `TVSourceDescriptor` namerno nema credentials.
- `TVPlaybackRequest` je diskriminisana unija. Catch-up eksplicitno nosi
  `startTimeMs` i `durationMs`; live nema implicitni seek početak.
- `TVPlaybackAdapter` dobija caller `AbortSignal`, raportira mogućnosti,
  prihvata seek u milisekundama, nudi `returnToLive`, state subscription i
  `destroy()`.
- `TVPlaybackController` iz `@lumen/player-core` otkazuje prethodni load pri
  promeni kanala, prosleđuje caller cancellation, zanemaruje zastarele rezultate
  i state notifikacije, odbija nedostupne mogućnosti, ograničava seek i uklanja
  adapter listener pri uništavanju. Adapter mora poštovati signal i u događaju
  vratiti istu request referencu da bi zastareli događaji bili odbačeni.
- Greške iz adaptera se pretvaraju u bezbednu poruku `Playback request failed`;
  URL, query parametri, credentials i proizvoljni `details` se ne prosleđuju.
  HTTP status i bezbedan code se čuvaju kada postoje.
- `HttpClient.get/getText` i postojeći Xtream authenticate/live-category/live-
  stream/EPG zahtevi sada primaju opcioni `{ signal }`. Caller abort se ne
  ponavlja kao transportna greška. Timeout poruka više ne sadrži URL.

## Vremenske jedinice i primer

Nasleđeni `PlayerAdapter` iz `@lumen/types` zadržava postojeće ponašanje:
`seek`, `getCurrentTime`, `getDuration` i `onTimeUpdate` koriste sekunde u web
implementaciji. Novi TV/session ugovor uvek koristi milisekunde. Konverzije su
izvezene iz `@lumen/player-core` kao `playerSecondsToMilliseconds` i
`millisecondsToPlayerSeconds`; dodavanje ugovora ne menja web playback.

```ts
import {
  TVPlaybackController,
  playerSecondsToMilliseconds,
} from "@lumen/player-core";
import { TV_CONTRACT_VERSION, type TVCatalogSnapshot } from "@lumen/types";

const catalog: TVCatalogSnapshot = {
  version: TV_CONTRACT_VERSION,
  source: { id: "living-room", kind: "m3u", name: "My playlist" },
  fetchedAtMs: Date.now(),
  categories: [{ id: "news", name: "News" }],
  channels: [], // Existing PlayerChannel[]
  epg: [{
    id: "news-1", channelId: "news-channel", title: "News",
    description: "", category: "News", hasCatchUp: true,
    startTimeMs: Date.now(), endTimeMs: Date.now() + 30 * 60_000,
  }],
};

const controller = new TVPlaybackController(platformAdapter);
const catalogAbort = new AbortController();
const load = controller.load({
  kind: "catch-up",
  sourceId: catalog.source.id,
  channelId: "news-channel",
  media: { type: "hls", url: "https://example.invalid/archive.m3u8" },
  startTimeMs: 1_797_120_000_000,
  durationMs: 30 * 60_000,
}, { signal: catalogAbort.signal });
await controller.seek(playerSecondsToMilliseconds(90));
// Owner of the screen calls controller.destroy() on its teardown.
```

URL values above are interface examples only. Real source URLs can contain
provider credentials and must never be logged, put in fixtures or copied into
tracked config. `packages/player-core/src/tv-contract.fixture.ts` is the
credential-free sample catalog fixture.

## Migracija za shell vlasnike

1. Importovati `TVCatalogSnapshot`, `TVPlaybackRequest` i
   `TVPlaybackCapabilities` iz `@lumen/types`; koristiti postojeće
   `PlayerChannel`/`PlayerCategory`, bez zasebnih shell shape-ova.
2. Composition layer instancira `TVPlaybackController` sa platformskim
   `TVPlaybackAdapter`. TV-004 i TV-005 adapteri treba da drže njihov media
   engine iza ovog interfejsa, ne da u UI prosleđuju `MediaSource` direktno.
3. Live request koristi `{ kind: "live", sourceId, channelId, media }`.
   Catch-up koristi `{ kind: "catch-up", ..., startTimeMs, durationMs }`.
   Channel/source promena treba da pokrene novi `load`; signal starog load-a se
   tada automatski abort-uje. Kod zatvaranja ekrana pozvati `destroy()`.
4. Prikazivati samo komande koje podržava `getCapabilities()`. Odbijena
   capability operacija baca `UnsupportedPlaybackCapabilityError`; UI treba da
   je tretira kao podržano stanje, a ne kao provider grešku.
5. Za početni stub klijentski vlasnik može napraviti lokalni adapter koji koristi
   postojeći `PlayerAdapter`. Pošto nasleđeni `PlayerAdapter.load` ne prima
   signal, stub mora imati svoj generation guard posle `await load()` i ne sme
   da tvrdi da je platform playback implementiran. Bolje je implementirati
   direktan signal-aware adapter kad se poveže TV-006/007/008 engine.
6. Xtream katalog/EPG pozive otkazivati sa istim signalom kada korisnik promeni
   source ili ekran. M3U parser i mapper ostaju u `@lumen/api`; nema dupliranja
   parsera u shell-u.

## Test fixture i validacija

Fixture: `packages/player-core/src/tv-contract.fixture.ts` — demo M3U source,
channel i EPG; nema credentials, privatnih URL-ova ni DOM zavisnosti. Testovi u
`tv-playback-controller.test.ts` pokrivaju kasni A rezultat nakon A→B, caller
abort naspram greške, redakciju, seek clamp i seconds↔milliseconds konverziju,
unsupported capability, unsubscribe i destroy.

Validacija ove implementacije beleži se u worker handoff/commit poruci. Planirani
paketni check-ovi: `@lumen/types`, `@lumen/api`, `@lumen/core`,
`@lumen/player-core`, `@lumen/session-core`, `@lumen/storage`, `@lumen/input`;
zatim root `lint`, `typecheck`, `test:unit`, `build` i
`release:qaf035:validate`. Nisu dodati novi package-i ili root test alias-i.

## Zavisnosti i preostali rad

- Nema root manifest, workspace, tsconfig, alias ili lockfile zahteva. Postojeći
  `@lumen/types` i `@lumen/player-core` workspace dependencies su dovoljni;
  `@lumen/api` već zavisi od `@lumen/types`.
- Oba shell-a treba da uvedu tanak `TVPlaybackAdapter` composition sloj. Nema
  fizičkog platform adaptera, test-source credentials, playback UI niti uređajske
  provere u ovom tasku.
- Legacy `PlayerAdapter` nema caller-signal parametar. On ostaje kompatibilan;
  platform adapter treba da koristi novi signal-aware ugovor. Ako je privremena
  bridge implementacija neophodna, generation guard važi samo za stanje klijenta,
  ne može prekinuti već započet platform load.
- Nijedan novi package, billing/cloud deo, web rewiring ili app-level migracija
  nije deo TV-003.
