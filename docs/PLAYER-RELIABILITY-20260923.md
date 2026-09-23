# Lumen / EXYU — ispravke posle audita, 23. septembar 2026.

**Status: aplikativne izmene implementirane i proverene lokalno; nisu push-ovane niti deploy-ovane. Dva SQL indeksa primenjena su i proverena u produkciji 23. septembra.** Ovo nije potvrda da su svi problemi iz audita rešeni.

## Pripremljene promene

| Problem | Promena | Dokaz |
|---|---|---|
| Nejasno odsustvo MP2 zvuka | „Trenutno bez zvuka“, objašnjenje dobavljačevog formata i mogućnosti gledanja slike; sklopljena oznaka „Bez zvuka“ može ponovo da se otvori | Render komponente na 320/390 px; sklapanje, otvaranje i reset pri promeni kanala |
| Odbijen iOS/native fullscreen | Rezervni prikaz preko celog viewport-a, vidljive komande i izlaz; uspešan native fullscreen ostaje prvi izbor na iOS-u | Unit scenariji; stvarna Player stranica na 390×844 sa namerno odbijenim API-jem, izlaz dugmetom i Escape |
| Zabrana autoplay-a tokom povratka iz pozadine | Rebuild prijavljuje postojeći PLAYBACK_AUTOPLAY_BLOCKED signal; UI staje i nudi ručno pokretanje; zakašnjela greška ne blokira novi kanal | Adapter test odbijanja i test promene izvora dok je play obećanje otvoreno |
| GET /player-analytics/config vraća 403 bez Origin-a | Prihvata same-origin Fetch Metadata sa dozvoljenim Referer poreklom; potpisano sesijsko vezivanje i postojeći POST Origin uslovi ostaju obavezni | Testovi uspešnog restore-a, odsutnog cookie-ja, lažnog/sličnog domena i zabranjenog POST-a |
| Zajednički /observe limit za gledaoce iza Nginx-a | Podrazumevano se veruje jednom loopback proxy hop-u | Produkcijski proces nema LUMEN_TRUST_PROXY_HOPS; testovi odvajanja klijenata i ignorisanja lažnog ranijeg hop-a/direct non-loopback headera |
| Previše ponovljenih warning/retry zapisa | Prvi zapis ide odmah, ponavljanja se sabiraju u prozoru od 10 sekundi; greške ostaju neposredne | 100 upozorenja daje dva zapisa sa ukupno 100 occurrences; flush pre promene izvora i pre završnog pagehide batch-a |
| Stream/SSO greške upisivane kao crash | Ostaju originalni događaji i dijagnostički replay; crash tabela ostaje za JS/React izuzetke; ekstenzije se odvajaju | Browser provera presretnutih lokalnih batch-eva; pravi React TypeError i dalje daje crash zapis |
| VOD/series content_kind prazan | Događaji nasleđuju izabrani kontekst sadržaja | Browser provera playback.started sa contentKind=vod |
| Generička VOD/series greška izvora | MEDIA_ELEMENT_4 dobija razumljivu poruku i „Prijavi problem“ bez tvrdnje da znamo da li je uzrok fajl, kodek ili server | Unit testovi za VOD i serije |

MP2 poruka ne vraća zvuk: web player objašnjava potvrđenu nepodržanu audio putanju. Nije uveden transcoder niti promenjen dobavljačev stream. HEVC obaveštenje više ne tvrdi da svi Safari uređaji podržavaju svaki takav izvor.

## Provere

- Lumen: 507/507 unit testova u 62 fajla; typecheck 3/3, lint 11/11, build 3/3, git diff --check. Build prijavljuje postojeće upozorenje o veličini Player bundle-a.
- Playwright: komponente i stvarna lokalna Player stranica. Spoljašnji demo zahtevi blokirani u fullscreen testu; crn video/spinner u tom testu nije validacija reprodukcije. Fizički iPhone, zvuk i dobavljačevi kanali nisu provereni.
- Analitički browser test presreće lokalni ingest/replay: nije slao testne događaje na produkciju. Potvrđeni contentKind, zadržan replay ID, odsustvo operativnih/extension crash redova, sabiranje upozorenja pri pagehide-u i zadržavanje aplikativnog crash-a.
- Lokalni artefakti: `output/playwright/mp2-mobile.png`, `mp2-mobile-320.png`, `mp2-mobile-collapsed.png`; `output/reliability/analytics-browser-check.js` i log; finalni unit/typecheck/lint/build logovi u istom output direktorijumu. Output je ignorisan u git-u.

## Backend i otvorene stavke

EXYU promena je u odvojenoj radnoj kopiji `exyu-tv-nextjs-reliability-20260923`. Uvedeni su kompaktna projekcija, cursor paginacija, obrada occurrences i prozor aktivne sesije od 120 sekundi bez budućih timestamp-ova. Lokalno prolazi 12 testova, TypeScript, scoped lint i Next production build. SQL kandidati i procedura su u `scripts/sql/player-analytics-reliability-20260923.md` tog repozitorijuma.

**Dashboard API ponovo radi u produkciji:** posle prijave vlasnika u Supabase potvrđeno je da nedostaju oba indeksa. Pojedinačno su kreirani sa `CONCURRENTLY`: `idx_player_events_time_id` i `idx_player_events_diagnostic_time_id`; oba su validna i spremna. Dijagnostički upit sada koristi indeks umesto paralelnog skeniranja i sortiranja: prva SQL strana od 1.000 redova traje 2,599 ms. REST cursor provera svih 30.000 traženih redova traje 9,495 s, bez duplikata; pre indeksa prva strana je padala sa 57014 posle 8,369 s.

Postojeći produkcioni API prošao je svih šest provera za 7/15 dana (12:21:23–12:22:18 UTC), HTTP 200 za 4,045–13,459 s. Ostaje eksplicitno ograničenje na 30.000 detaljnih događaja; `dataQuality` prijavljuje skraćen skup. Svih osam worker-a ostalo je online bez promene PID-a ili broja restartovanja tokom tih provera, a svež heartbeat potvrđuje nastavak prijema događaja. To nije dokaz da je istorijski problem memorije rešen. Broj aktivnih sesija nije broj istovremenih gledalaca. Lokalni agregatni dokazi su u `output/reliability/benchmark-analytics-after-indexes.json`, `dashboard-after-indexes.jsonl` i `panel-after-indexes.jsonl`.

Proveren je i konfigurisan PHP/cURL poziv sa Main/panel servera za oba perioda: HTTP 200 bez cURL greške za 12,070 i 12,932 s, unutar limita od 20 s. Korišćen je panelov konfiguracioni fajl i postojeći PHP runtime sa cURL podrškom. Ova provera potvrđuje serverski put do API-ja; nije vizuelna provera panel stranice.

Prilikom izdavanja prvo obezbediti backend obradu occurrences, zatim Lumen coalescing, da pregled događaja zadrži tačan broj ponavljanja. Istorijski pogrešno klasifikovani crash zapisi nisu menjani; nova klasifikacija važi za nove događaje.

Nisu utvrđeni ili rešeni svi specifični catch-up/VOD kvarovi dobavljača, niti uzrok 27 restartovanja EXYU worker-a zbog memorije. To ne treba zatvarati na osnovu ovog build-a. Produkcioni sw.js/registerSW.js već imaju no-store; stare otvorene sesije ne dokazuju dodatni cache kvar.

Originalni prljavi checkout-i oba projekta ostali su netaknuti. Backend route/data datoteke na izabranoj bazi odgovaraju produkciji, ali celokupna Next.js grana nije potvrđena kao identična aktivnom release-u; uskladiti bazu pre deploy-a.
