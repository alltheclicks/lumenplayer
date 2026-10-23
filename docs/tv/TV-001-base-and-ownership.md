# TV-001 — baza implementacije i vlasništvo nad putanjama

Datum provere: 2026-10-21, Buildara. Procena je lokalna; udaljeni refovi nisu osvežavani.

## Ishod i granica zadatka

Preporučena implementaciona baza je **plan/dizajn `544bed8902e7386a20aff96510868026c4f86970` + cela P4 istorija do `2f8d14dc8fa1d69858c564e07b7147ef59b53922`**. Ne počinjati TV klijente iz starije aplikacione baze bez P4 ograda i testova. Nijedan pregledani branch tip trenutno ne sadrži oba skupa. Integracioni commit još **ne postoji**; njegovo pravljenje i provera pripadaju koordinatoru uz posebno ovlašćenje za merge. TV-003/004/005 ostaju `queued` dok koordinator ne zabeleži stvaran dostupan base hash i rezervacije u živom registru.

TV-001 isporučuje ovu procenu za review, ne integraciju. Nisu rađeni merge, cherry-pick, push, instalacija SDK-a, promene servisa, uređaja ili dizajn izvoza. Nisu menjani plan, entry point fajlovi ili stale kopija `TASKS.md` u ovom worktree-ju.

## Identitet, immutable baze i živo stanje

- Repo: `alltheclicks/lumenplayer`; origin `git@github.com:alltheclicks/lumenplayer.git`.
- Worker: `Codex/TV-001-764eab2a-71a9-47cd-88f8-640501418dd3`.
- Worktree: `/home/filip/.t3/worktrees/lumen-player/t3-2ef2cd12`, branch `t3/tv-base-ownership`.
- Worker početna baza: `544bed8902e7386a20aff96510868026c4f86970`; jedina rezervisana deliverable putanja: ovaj dokument.
- Živi registar: vrednost `git config --local --get klaro.taskRegistry`, provereno `/home/filip/.t3/worktrees/lumen-player/t3-37e08d21/TASKS.md`. Claim je upisan pod `mkdir` lock-om u zajedničkom Git direktorijumu. Registry promene ostaju izvan worker commita.

| Ref / uloga | Tačan hash |
|---|---|
| Zajednički predak, javni rebrand | `0105fb73479211e060198db56311a0fb11cb2ee0` |
| `t3/klaro-codebase-analysis`, plan + dizajn + koordinaciona pravila | `544bed8902e7386a20aff96510868026c4f86970` |
| `t3code/evaluate-svelte-convex-effect-fit`, P4 | `2f8d14dc8fa1d69858c564e07b7147ef59b53922` |
| `t3/sync-klaro-design-dashboard`, mirror | `bfd5d3f2717652b1f5e1b4ea1d019956c0150c0c` |
| `feat/klaro-player-rebrand`, glavni checkout | `c0db09a8437cfd376f9a193e86123567b4765d49` |

`git branch -vv` i `git worktree list --porcelain` pregledani su za sve lokalne grane. Plan, TV-001 i TV-002 worktree počinju na `544bed8`; design worktree na `bfd5d3f`; P4 na `2f8d14d`. Ostalih pet lokalnih grana (`activation-design`, `compare-klaro-codebase`, `klaro-player-logo-design`, `klaro-project-rebrand`, `premium-logo-animation`, sve sa prefiksom `t3code/`) počinju na zajedničkom pretku `0105fb7`. P4 i tracked origin ref bili su poravnati; to nije nova GitHub provera. Glavni rebrand branch je lokalno 4 commita ispred svog tracked origin refa.

Snapshot dirty worktree-ja na početku procene:

- Glavni checkout `/home/filip/dev/t3/lumen-player`: izmenjeni `.claude/skills/design-pull/SKILL.md`, `.claude/skills/design-push/SKILL.md`; untracked `brand/`.
- `t3code-5b0ffd3f` / logo-design: izmenjen `scripts/design-sync/build-bundle.mjs`; staged brisanja `scripts/design-sync/templates/{channel-list,login,player-controls}.html`; untracked `docs/KLARO-NALOZI-I-PANEL.md`, `scripts/design-sync/snapshot-redesign.mjs`, `scripts/design-sync/static/`.
- `t3code-17697650` / premium-logo-animation: untracked `prototypes/`.
- `t3-37e08d21` / koordinator: izmenjen živi `TASKS.md` usled koordinacije.
- Ostali worktree-ji, uključujući P4 i design mirror, bili su čisti. TV-002 može nastaviti nezavisne promene posle ovog snapshot-a.

Ništa od navedenog nije input za automatsko kopiranje, stash ili čišćenje. Ne uključivati untracked poslovni spec/brand/prototipe u integracioni skup bez zasebnog pregleda. Pre integracije ponoviti status provere; dirty sadržaj nije obuhvaćen hash-om grane.

## Izabrani integracioni skup

Poći od `544bed8` i integrisati P4 tip jednim merge-om koji čuva svih deset postojećih commit-a. Ne cherry-pick-ovati samo testove ili ponovo izvoditi već završen P4 posao.

| P4 commit, redosled od pretka | Sadržaj koji se čuva |
|---|---|
| `7d938044dc25ed2d5c2bb58b500e7ab32b96bdd8` | Stack odluka, osvežen P4 plan i reference |
| `35986a4565103f6da9be1a6b2e14da61c7c51bb5` | 0a: standalone strict typecheck svih paketa |
| `9064cc3703b7be51c1ea091cfb90afdfe16fa4df` | 0b: portable TS lib surface |
| `1bd31086709b019e4736f5506fd4681d049dfef5` | 0d: uklonjeni mrtvi plaintext credentials helperi |
| `b4c6aff69355518545c71bfd72b0123a4894f149` | Evidencija 0b/0d |
| `916a24a080b5cde4e99575910a5c25ebce510e88` | 0c: ESLint portability/import guard |
| `942753ca146115e6519a7f4359e2dd6ff4c0cc25` | 1a: 36 SessionStore characterization testova |
| `be329aef6364880aa2dca1bbf8c08649e65be922` | 1b deo 1: 58 characterization testova web modula |
| `e8e40d295009e356b5ccb5dd29e8d5b995f4be03` | P4 napredak i istorijska validacija |
| `2f8d14dc8fa1d69858c564e07b7147ef59b53922` | Realtime prioritet i payment odluka |

Plan/design istorija već sadržana u izabranoj početnoj bazi:

- `bfd5d3f2717652b1f5e1b4ea1d019956c0150c0c`: read-only mirror.
- `291710d1d7843590b8a1e2b6cae52e0412e0ee1a`: GRAND_PLAN i entry points.
- `060bfba835db738c02bc5c07f2f2c66fa5dc2bad`: postojeći merge plan/design grana.
- `c0db09a8437cfd376f9a193e86123567b4765d49`: evidencija tog spajanja.
- `544bed8902e7386a20aff96510868026c4f86970`: TASKS protokol i lokalizacija.

TV-001 dokument i TV-002 deliverable su zasebni review commit-i koje koordinator uključuje kasnije; TV-002 SDK instalacije nisu Git sadržaj i ne prenose se merge-om.

## Preklapanje, konflikti i ograničenja provere

`git merge-base 544bed8 2f8d14d` vraća `0105fb73479211e060198db56311a0fb11cb2ee0`. U odnosu na tog pretka plan/design menja 49 putanja, P4 33; presek putanja je prazan. P4 menja root ESLint i lockfile, package manifests/tsconfigs, API type-only kod, uklanja mrtvi storage modul, dodaje testove i dopunjuje istorijske odluke/handoff. Plan/design dodaje mirror, plan i koordinaciona pravila. Nema trenutno utvrđenog tekstualnog konflikta.

Read-only provera lokalnim Git 2.34.1:

```sh
git merge-tree 0105fb73479211e060198db56311a0fb11cb2ee0 \
  544bed8902e7386a20aff96510868026c4f86970 \
  2f8d14dc8fa1d69858c564e07b7147ef59b53922
```

Rezultat: exit 0, nula conflict markera, nula `changed in both` / `added in both` zapisa. `removed in remote` za mrtvi credentials modul je očekivano P4 brisanje. Noviji `merge-tree --write-tree --messages` nije podržan u ovom Git-u (usage/exit 129), zato je korišćen gornji podržani oblik. Nije kreiran merge commit niti promenjen index/working tree; tekstualna procena ne zamenjuje stvarnu integraciju i regression provere.

**Semantički konflikti ostaju i kad nema Git konflikta:**

- P4 D5 i stari multiplatform plan traže ceo P4 pre TV-a i web pa native sekvencu. Noviji GRAND_PLAN conflict register i TASKS dopuštaju minimalne ugovore uz paralelne TV shell-ove. To je važeći redosled; ne čekati potpuno razbijanje velikih web komponenti.
- Stari handoff kaže da je izbor Android framework-a otvoren; novija odluka ga zatvara na react-native-tvos/Media3. Ne praviti Kotlin-only aplikaciju.
- Design README tvrdi da je srpski prototype copy proizvodni copy. Noviji entry points i GRAND_PLAN §9 zahtevaju English default, lokalizacione resurse i per-device izbor jezika. Mirror ostaje neizmenjen.
- Sačuvati EXYU composition root, SSO i tehničke `@lumen/*` identifikatore. Ni Convex niti media processing nisu preduslov internog TV shell-a. Realtime `/v1` pitanje ne rešavati u TV-001.

## Postojeći API-ji i šta se ne izvlači ponovo

Pročitani su septembarski handoff, relevantni HANDOFF zapisi, VISION, SESSION-ARCHITECTURE, istorijski BACKLOG, multiplatform plan, P4 plan i P4 HANDOFF na tačnom tipu. Poslednja dva potvrđuju da su 0a–0d, 1a i 1b deo 1 završeni. P4 beleži 603 unit testa i prolaz potrebnih check-ova; ovo je **istorijska evidencija**, ne novo pokretanje testova. P4 nije već izdvojio catchup/EPG/HLS pakete.

| Postojeća putanja / API | Upotreba i konkretan nedostatak za TV-003 |
|---|---|
| `packages/types/src/index.ts` | `PlayerChannel`, `PlayerCategory`, `Program`, `MediaSource`, `PlaybackError`, `PlayerAdapter`, `RendererAdapter`, `StorageAdapter` već postoje. `PlayerAdapter.load(MediaSource)` nema tipiziran live/catch-up zahtev, capability/lifecycle ugovor ili caller cancellation. `seek(time)`/time update ne navode jedinice; `RendererAdapter` i session koriste eksplicitne milisekunde. U novom ugovoru i adapterima jasno razgraničiti jedinice bez tihe promene web ponašanja. |
| `packages/api/src/` | DI `HttpClient`, `XtreamCodesService`, M3U parser/mappers; postoje categories/streams/EPG, live i catch-up URL builders. HTTP ima sopstveni timeout AbortController, ali `get/getText` nemaju caller signal; timeout poruka može sadržati URL. TV error mapiranje/redakcija ne sme izložiti credentials. Ne praviti drugi Xtream klijent. |
| `packages/session-core/src/` | SessionStore/reducer već postoji; `SessionSource.metadata` je generic record. Storage/BroadcastChannel još nisu ubrizgani. Za prvi standalone stub moguće je `persist:false, syncAcrossTabs:false`; to nije native persistence rešenje. P4 test otkriva persisted-sessionId precedence; ne menjati usput. |
| `packages/player-core/src/` | SeekEngine i IdleTimer već postoje; nisu playback engine. |
| `packages/input/src/` | Samsung/LG key maps i NumericChannelInput postoje; `Platform` je samo `tizen | webos | web`. Android hint/focus je dopuna, ne ponovna implementacija key mapa. |
| `packages/storage/src/` | `StorageAdapter` tip je async, dok postojeći SessionStore koristi sync browser storage; ne tretirati ih kao zamenjive bez adaptera. DOM izuzetak ostaje u P4. |
| `apps/web/src/components/player/`, `services/`, `adapters/` | Catch-up policy/config, EPG parser/decoder i HlsPlayerAdapter ostaju ovde. TV ne sme importovati ove app module. P4 2a–2d / selektivni 3a/3d/3f su kandidati prema stvarnoj potrebi; ne kopirati ceo VideoPlayer i njegov wiring. |

`git ls-tree` obe baze potvrđuje samo `apps/{web,proxy,push-api}` i devet postojećih paketa. `apps/tv-web`, `apps/android-tv`, `packages/catchup-core`, `packages/epg`, `packages/player-hls` ne postoje. Istorijske LP-2001–2004 oznake `pending-review` nisu dokaz scaffold-a.

## Konkretna podela vlasništva za sledeće claim-ove

Ovo je **predlog rezervacija za koordinatora**, ne nova aktivna rezervacija niti promena downstream redova. Svaki stvarni claim mora pod lock-om imenovati sesiju, base i tačne putanje. Carve-out putanje u tabeli nisu vlasništvo nadređenog direktorijuma.

| Jedini vlasnik | Putanje / granica |
|---|---|
| Koordinator / integration owner | Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, `eslint.config.mjs`, `vitest*.{ts,mts}`, `.github/workflows/`, `packages/tsconfig/`; entry points, GRAND_PLAN i živi registar. Samo on primenjuje root dependency/config zahteve drugih radnika. |
| TV-003 shared-contract owner | `packages/{types,api,core,player-core,session-core,storage,input}/`; minimalni novi `packages/catchup-core/`, `packages/epg/` ako su potrebni; `docs/tv/TV-003-contracts.md`. Package-local manifests pripadaju njemu, root lockfile koordinatoru. Ne rezervisati/praviti `player-hls` dok stvarna potrošnja ne zahteva taj ekstrakcioni korak. |
| TV-004 TV web shell owner | `apps/tv-web/`, **osim** `src/adapters/tizen/` i `src/adapters/webos/`; uključuje `src/{ui,focus,i18n,composition,testing}/`, lokalne entry/config fajlove, `platforms/{tizen,webos}/` packaging i `scripts/`; `docs/tv/TV-004-shell.md`. Shell composition jedini povezuje platform adaptere preko ugovora. |
| TV-006 Samsung adapter owner | Samo `apps/tv-web/src/adapters/tizen/`, `docs/tv/TV-006-samsung.md`; AVPlay, lifecycle i platform errors. Promene shell composition/manifest-a traže TV-004 vlasnika. |
| TV-007 LG adapter owner | Samo `apps/tv-web/src/adapters/webos/`, `docs/tv/TV-007-lg.md`; zaseban media/lifecycle adapter. Ista granica prema TV-004. |
| TV-005 Android shell owner | `apps/android-tv/`, **osim** `src/adapters/android/` i `android/app/src/main/java/com/lumen/tv/playback/`; react-native-tvos scaffold, `src/{ui,focus,i18n,composition,testing}/`, Gradle/Metro/Babel/package-local config i resursi; `docs/tv/TV-005-shell.md`. Ovo je naziv direktorijuma, ne odluka o javnom application ID-u. |
| TV-008 Android playback owner | `apps/android-tv/src/adapters/android/`, `apps/android-tv/android/app/src/main/java/com/lumen/tv/playback/`, `docs/tv/TV-008-android-playback.md`; Media3 bridge i lifecycle. Gradle dependency/registration promene dostavlja TV-005 vlasniku; ne proširuje rezervaciju prećutno. |
| TV-002 environment owner | `docs/tv/TV-002-environment.md`, `scripts/tv-env/`, izolovani SDK direktorijumi; bez root dependency/config fajlova i klijentskog koda. |
| TV-001 ovaj worker | Samo ovaj novi dokument i TV-001 red registra. Nema ownership-a nad shared kodom ili root konfiguracijom. |

TV-003 ne sme paralelno menjati web/proxy potrošače zbog ekstrakcije bez dodatne eksplicitne rezervacije. Za prvu verziju preferirati additive ugovor; ako treba rewiring, koordinator rezerviše konkretne `apps/web`/`apps/proxy` fajlove u serijskom koraku i sprovodi/promeri integraciju. Nema dve implementacije istog source/catch-up ugovora. UI mock adapteri žive isključivo u `src/testing/`, jasno su označeni i ne otvaraju mrežu; platform adapter direktorijumi ostaju slobodni do svojih claim-ova.

## Minimalni naredni koraci i izvršive provere

1. **Koordinator: napravi dostupnu integracionu bazu.** Nakon ovlašćenja za merge, iz čistog novog worktree-ja u odobrenom T3 namespace-u primeni sledeći lokalni postupak. Ovo su naredbe za koordinatora; TV-001 ih nije izvršio.

   ```sh
   git worktree add -b t3/tv-integration <new-integration-worktree> 544bed8902e7386a20aff96510868026c4f86970
   cd <new-integration-worktree>
   git merge --no-ff 2f8d14dc8fa1d69858c564e07b7147ef59b53922
   git merge-base --is-ancestor 544bed8902e7386a20aff96510868026c4f86970 HEAD
   git merge-base --is-ancestor 2f8d14dc8fa1d69858c564e07b7147ef59b53922 HEAD
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm typecheck
   pnpm test:unit
   pnpm build
   pnpm release:qaf035:validate
   git rev-parse HEAD
   ```

   Zabeležiti hash i rezultate. Mirror mora ostati identičan `544bed8` (`git diff 544bed8 HEAD -- design/` prazan); uklonjeni `packages/storage/src/credentials.ts` ne sme se vratiti. Proveriti da root typecheck zaista obuhvata standalone pakete i da su dodatni P4 testovi uključeni. Očekivani istorijski broj je 603 pre novih promena, ali broj sam nije kriterijum prolaza. Ne menjati `klaro.taskRegistry`; integracioni TASKS snapshot nije živi red.

2. **Koordinator: objavi lokalni hash i rezervacije pod lock-om.** Tek kada hash postoji i worktree/base je dostupan radnicima, može promeniti TV-003/004/005 u `ready`. Potrebna je jedna konkretna integration sesija za root fajlove. Nema potrebe da se TV-002 SDK commit čeka da bi se pisao shell; paketovanje ostaje uslovljeno njegovim toolchain dokazom. Review status TV-001 sam ne otključava downstream zadatke.

3. **TV-003: najmanji ugovor, ne ceo P4.** Poći od integracionog hash-a; reuse gore navedene tipove/API-je. Isporučiti verzionisan shape za source/catalog/EPG, live/catch-up zahtev sa eksplicitnim jedinicama, seek/return-to-live, capabilities, cancellation/stale-result, greške i lifecycle/cleanup. Ugovor i fixture moraju moći da se koriste iz oba client family-ja bez DOM-a, hls.js ili React-a. Dodati testove za kanal A→B sa kasnim A rezultatom, abort naspram greške, seek/clamp/time conversion, capability rejection i destroy/unsubscribe. Ne proširivati na billing/cloud. Za promene postojećih paketa izvršiti `pnpm --filter @lumen/types typecheck`, `pnpm --filter @lumen/api typecheck` i ekvivalent za svaki izmenjeni paket, zatim svih pet gore navedenih regression komandi. Nove test alias-e root Vitest konfiguraciji dodaje integration owner.

4. **TV-004/005: shell može paralelno preko eksplicitnog stub-a.** Početni shell-ovi koriste postojeći `PlayerAdapter` preko lokalne composition granice dok TV-003 dodatni ugovor nije stvarno integrisan. Ne izmišljati zaseban shared contract. Dokumentovati stub bez tvrdnje o playback-u. Pre UI implementacije pročitati `design/README.md`, `1d Kolone.dc.html`, PlayerViewer/KlaroPlayer i TV guide reference; primeniti column-collapse nameru, fokus/Back/OK, loading/error i English-default resurse sa dostupnim per-device jezikom. Ne importovati React DOM komponente iz `apps/web` u RN.

   TV-004 treba da uvede package ime `@lumen/tv-web` i lokalne skripte `typecheck`, `lint`, `build:tizen`, `build:webos`, `package:tizen`, `package:webos`. Ciljne provere posle scaffold-a su:

   ```sh
   pnpm --filter @lumen/tv-web typecheck
   pnpm --filter @lumen/tv-web lint
   pnpm --filter @lumen/tv-web build:tizen
   pnpm --filter @lumen/tv-web build:webos
   pnpm --filter @lumen/tv-web package:tizen
   pnpm --filter @lumen/tv-web package:webos
   ```

   To su **skripte koje tek treba implementirati**, ne postojeće komande u ovoj bazi. Build izlazi neka budu `apps/tv-web/dist/{tizen,webos}/`, paketi `apps/tv-web/artifacts/{tizen,webos}/` (ne commitovati generisane pakete). TV-002 određuje proverene CLI binarne putanje i prerequisites za `.wgt`/`.ipk`; certificate/licensing nedostatak mora ostati eksplicitan blocker, bez izmišljene uspešne paketizacije.

   TV-005 treba da uvede `@lumen/android-tv`, lokalne `typecheck`/`lint` skripte i Gradle wrapper. Ciljne provere posle scaffold-a: `pnpm --filter @lumen/android-tv typecheck`, `pnpm --filter @lumen/android-tv lint`, zatim iz `apps/android-tv/android/` komanda `./gradlew :app:assembleDebug`. Očekivana standardna putanja: `app/build/outputs/apk/debug/app-debug.apk`; worker beleži stvarnu putanju i hash build commita. Ne navoditi `react-native run-android`, install ili emulator komande kao Buildara validaciju. Wrapper/JDK/SDK kompatibilnost i react-native-tvos verziju uskladiti sa TV-002 pre dependency zahteva integration owner-u.

5. **Koordinator: serijski integriše root zahteve i shared contract.** Klijentski radnici dostavljaju tačne package verzije/workspace dependency zahteve; ne pišu lockfile paralelno. Nakon TV-003 integracije oba shell-a prelaze na isti ugovor i ponavljaju svoje build/check komande plus odgovarajuće focus/language/stub testove. Device instalacija i dokaz ponašanja ostaju zasebni TV-009/010/011 zadaci kroz Mac, sa stvarno pronađenim uređajem i build commit-om.

## Blockeri i review dokaz

- **Baza / zavisnost:** kombinovani plan/design/P4 commit još nije napravljen; TV-001 nema ovlašćenje za merge. Koordinator pravi i validira bazu pre downstream readiness. Ovo ne sprečava završetak ove read-only procene.
- **Build/package:** SDK, certifikati i konkretne verzije alata pripadaju TV-002; ovde nisu instalirani niti proveravani. Android i oba TV-web scaffold-a još ne postoje.
- **Uređaji:** nema nove device provere; Sony model/OS i pristup ostaju otvoreni prema registru. Istorijski browser/web testovi ne potvrđuju TV kompatibilnost.
- **Provera ovog deliverable-a:** immutable hash/ref provere, inventar svih lokalnih branch/worktree statusa, poređenje 49/33 putanje bez preseka, podržani read-only merge-tree i pregled navedenih API-ja/handoff-a. Za dokument se koristi `git diff --check`; aplikacioni testovi nisu ponavljani jer aplikacioni kod nije promenjen i kombinovana baza još ne postoji.

Sledeći vlasnik: koordinator pregledava ovaj dokument i lokalni worker commit, zatim uz ovlašćenje izvršava integracioni korak i upisuje stvaran downstream base. TV-001 ide u `review`, ne `done`; downstream statusi ostaju neizmenjeni.
