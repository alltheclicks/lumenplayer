# Klaro Player — logo, 2026 krug

**Brief (29. 9. 2026):** OTT player koji radi na svim platformama — moderan, stabilan, jednostavan za upotrebu. Prethodni krugovi su obrisani na zahtev vlasnika („sve je kao 2022“).

## Istraživanje (šta rade top studiji 2025–2026)
- LogoLounge 2026 (30.000+ logotipa): Slant Break, Roll Over, Tri-Link, Colorforms, Crack…
- Motion-first, adaptivni identiteti; DixonBaxi (Max, All4 „playbar“, Freely).
- Apple iOS 26 **Liquid Glass**: višeslojne ikone (Icon Composer), staklo, spekularni odsjaj, light/dark/tinted/clear režimi.
- Neo-minimalizam sa ličnošću; savremeni groteski (Geist, Inter Tight, Bricolage Grotesque).

## Glavni pravac: CUT PLAY
Silueta je jednakostranični play trougao; vertikalni rez (30 % širine) i dva reza pod tačnih 45° ispisuju **K**. Iz daljine se vidi play, izbliza K. Četiri dela čine jedan oblik: „One setup. Every screen.“ (splash: delovi dolaze sa različitih ekrana i spoje se).
- Master: `concepts/cut-play-mono.svg`, `-blue`, `-reversed` (audit 100/100, bez `<text>`, samo krive).
- Ikone (prezentacija, sa filterima): `concepts/cut-play-icon-glass-dark.svg`, `-light`.
- Lockup: `concepts/cut-play-lockup-dark.svg`, `-light` (wordmark = Geist 650/400, pretvoren u krive).
- Prezentacija: `klaro-2026.html` / `klaro-2026.png` (hero, master, iOS 26 home screen, TV launcher, light/dark ikona, paleta, konstrukcija, motion storyboard, alternative).

## Alternative (tipografske)
- **Slant K** — samo K je iskošen (12°), Geist.
- **Character K** — Bricolage Grotesque (ink trap detalji).

## Rizici i otvoreno
- Cut Play pripada porodici „podeljen play trougao“ (npr. Google Play). Razlika: jedna boja, rezovi čitaju K, vertikalni rez stuba. Obavezna je trademark pretraga.
- Ime blizu **Claro** / **Klarna**: bez crvene/roze i bez lowercase „klaro“.
- Fontovi: Geist, Inter Tight, Bricolage Grotesque — SIL OFL 1.1 (`_src/fonts/`, licence uključene); dozvoljena upotreba i izmena u logou.
- Glass ikone su renderi za prezentaciju (filteri/gradijenti). Za produkciju se prave slojevi za Icon Composer (iOS) i adaptive icon (Android) posle odobrenja.

## Novi znakovi (bez play-a i TV-a) — 29. 9. 2026
Povratna informacija: „to je već dosta bolje, samo je play trougao malo bezveze; može li drugi znak, a da nije TV ili play?“ Jezik ostaje isti (Liquid Glass, Geist, preciznost); menja se samo znak. Pregled: `klaro-2026-signs.html/.png`, izvor: `_src/build_options.py`.
- **A · Open Axis K** — četiri poteza izlaze iz jedne tačke (tvoje podešavanje) ka svakom ekranu; zajedno pišu K. Audit 98.
- **B · Cut Arch** — luk (prolaz) sa ravnom, stabilnom osnovom, isečen u K. Audit 99.
- **C · Cut Slant** — blok nagnut napred za tačnih 15°, isečen u K: uvek dalje, tačno gde si stao.
- Odbačeno: **Facet K** (geometrija nije bila dovoljno čista); **krug isečen u K** (Claro istorijski koristi crveni krug).

## Podvarijante B i C (29. 9. 2026)
Izabrani B (Cut Arch) i C (Cut Slant). Po 6 podvarijanti: `klaro-2026-variants.html/.png` (i `-B.png`, `-C.png`), master fajlovi u `concepts/variants/`, izvor `_src/build_variants.py` (opšti `k_cut`: rez stuba + dva kraka iz spoja, zadati uglovi i razmak).
- B1 Original · B2 Tall · B3 Wide & calm · B4 Open door (glava izlazi iz luka) · B5 Fine cut · B6 Steep K (60°)
- C1 Original · C2 Soft · C3 Narrow · C4 Bold · C5 Forward step · C6 Sharp K (60°/45°)

## Interni shelf test (29. 9. 2026)
`_internal/shelf-test.html/.png`: B3 i C4 među stvarnim ikonama konkurenata (TiviMate, IPTV Smarters, Plex, VLC, Kodi, Stremio, Jellyfin, Infuse, GSE, XCIPTV, Netflix, YouTube, Max, Disney+, Prime Video), na telefonu, TV launcheru i na 32 px. Folder je u `.gitignore` (tuđi žigovi, ne objavljivati).
- Oblik je jedinstven: nijedan konkurent nema K-u-luku ili K-u-kosom-bloku.
- **Boja pločice:** tamna navy („night“) se stapa sa TiviMate/Jellyfin/Plex; plava se sudara sa Prime Video/Stremio/Smarters; bela sa VLC/Infuse/YouTube. **„Ice“ (svetla ledeno-plava pločica, plavi znak) se najviše izdvaja i niko je ne koristi**; poklapa se i sa imenom („klaro“ = bistro).
- Na 32 px C4 (kosi) se nešto brže prepoznaje od B3.
- TV launcher: Klaro baner sa lockup-om je najčitljiviji u redu.

## B/C odbačeni — liče na Kodi (29. 9. 2026)
Vlasnik: „liči na mrtvi Kodi“. Tačno: Kodi logo je plavo K sklopljeno od geometrijskih delova, a naš isečen K je ista porodica. To je propust u shelf analizi (Kodi je bio u testu). **Pouka: u OTT kategoriji plavo geometrijsko K = Kodi; bez K monograma od delova.**

## Wordmark-led krug
`klaro-2026-wordmarks.html/.png`, izvor `_src/build_wordmarks.py`. Ime je logo (kao Netflix, Max, Prime Video, Tubi, Hulu); app ikona = ime na „ice“ pločici; favicon = prvo slovo.
- W1 Geist Heavy · W2 Caps (KLARO) · W3 Character (Bricolage) · W4 Compact (Bricolage uži) · W5 Clear cut (linija svetla kroz ime) · W6 Inter Tight
- Rizici: W5 može da se pročita kao precrtano; crni bold „Klaro“ na belom (W1, W6) je blizu stila „Klarna.“, pa držati ice/plavu paletu i bez tačke na kraju.

## Wordmark krug odbijen — liči na Klarna (29. 9. 2026)
Vlasnik: „liči na Klarna. ne ne, dalje“. Ime Klaro je vizuelno blizu „Klarna“, pa jak tipografski wordmark uvek vuče na nju. **Pouka: znak mora da nosi identitet; ime ide lakšim rezom pored znaka.**

## Novi znakovi S1–S6
`klaro-2026-signs2.html/.png`, izvor `_src/build_signs2.py`, mono master fajlovi `concepts/signs2/` (audit 97–99). Bez K, play-a, TV-a, kruga i crnog bold imena.
- S1 Prozor (luk + linija svetla) · S2 Slojevi (tri staklena panela) · S3 Trag (blok sa tragom kretanja) · S4 Obeleživač · S5 Odsjaj (dve kose trake) · S6 Fokus (dva ugla)
- Rizici su navedeni na tabli (vrata/nadgrobni kamen, Buffer slojevi, „brza dostava“, Pocket, „//“, skeniranje/fullscreen).

## S1–S6 odbijeni; KP monogram (29. 9. 2026)
Vlasnik: „ne. a neka varijanta kao PayPal logo? dvobojna integracija KP?“ Tabla `klaro-2026-kp.html/.png`, izvor `_src/build_kp.py`, fajlovi `concepts/kp/` (u boji i crno). Presek slova je treća boja (clip-path).
- KP1 Preklop (kosa, najbliže PayPal ideji) · KP2 Uspravno · KP3 mala slova kp (Bricolage) · KP4 P iza K · KP5 kurziv sa rezom (radi u jednoj boji) · KP6 staklo
- Rizik: KP1/KP5/KP6 su kosi, dvoplavi i sa preklopom, pa su blizu PayPal-a. Trademark pretraga je obavezna.

## KP odbijen (29. 9. 2026)
Vlasnik: „ne ne ne. sve je loše.“ Pauza u pravljenju novih krugova dok ne stignu konkretne reference.

## Prvi pozitivan signal: AI reference (29. 9. 2026)
Higgsfield je imao 0 kredita, pa je vlasnik sam generisao slike (spoljni generator) i izdvojio tri: „ova tri nisu loša“. Sačuvane su u `references/` (ref-02-flow-forward, ref-12-always-in-sync, ref-05-continuous).
Zajednički DNK: **ravno (flat), dve boje (Navy #0D1729 + Blue #0669FE), jedan podebeo geometrijski znak sa dijagonalnim rezom/zamahom, beli fon, „Klaro“ bold + „Player“ regular, stacked lockup.** Bez stakla i efekata.
Čiste vektorske verzije: `klaro-refs.html/.png`, izvor `_src/build_refs.py` (shapely booleani: tačni krugovi, linije, uglovi), fajlovi `concepts/refs/` (light i crno).
- A1/A2 Flow Forward (krug sa zamahom) · B1/B2 Always in Sync (dva panela spojena preklopom, 30°) · C1/C2 Continuous (krug isečen u K)

## IZABRAN PRAVAC: dva panela sa S-otvorom (29. 9. 2026)
Vlasnik je poslao tri AI table (`references/board-10/11/12`) i prihvatio preporuku: **znak i pattern sa table 10**, motion ideja sa table 11 („odvojeno → spajanje → u sinhronizaciji“).
- Geometrija: `_src/klaro_mark.py`. Panel L-oblika (W 270, H 336), izrezan donji desni deo ispod ivice na y=112; pojas S-otvora 92 = poluprečnik krivine; plavi = tamni panel okrenut za 180°; paneli dele kratku ivicu od 12 (nema dodira u tački); spoljni uglovi R 48; nagib 15°.
- Font: **Montserrat** (SIL OFL, `_src/fonts/`), „Klaro“ Bold 700 + „Player“ Regular 400; tagline „ONE SETUP. EVERY SCREEN.“ Medium sa razmakom.
- Boje: Navy #0D1729, Blue #0669FE, Mist #F3F5F9, White.
- Tabla: `klaro-direction.html/.png` (znak, lockupi, app ikone, jedna boja, konstrukcija, pattern, TV baner, animacija, boje, font). Izvor `_src/build_klaro.py`, master fajlovi `concepts/klaro/` (audit 98).
- Sledeće: posle potvrde, pun komplet (export PNG/ICO, iOS/Android/TV ikone, web ikone, BRAND-GUIDELINES.md).

## Spojevi + K (29. 9. 2026)
Vlasnik: na konstrukciji (06) krivina tamnog panela nije „synced“ sa plavim (kratka zajednička ivica od 12 je pravila pomak), i sredina treba više da liči na gornji deo slova K, jer animacija može da ide zoom sa „Klaro Player“ na K i da tu stane.
- Ispravka: JOIN = 0. Krivina kreće tačno iz plavog ugla, a paneli se dodiruju u jednoj tački (u jednoj boji mora ići mali razmak).
- `klaro-k.html/.png`, izvor `_src/build_kfit.py`, fajlovi `concepts/klaro-k/`: V0 S-otvor (usklađen) · V1 prava dijagonala (stub + krak K, ~53°) · V2 otvoreno K. Preko svake je proba sa Montserrat Bold K nagnutim 15°, plus skica animacije za V1.

## Beli centar = K iz fonta; font za OTT (29. 9. 2026)
Vlasnik: V0 je ok, ali beli centar treba da bude u potpunosti deo slova K iz fonta. V1 je ok, ali sa mekšim ivicama. Font za „Klaro Player“ treba da bude jako moderan, vezan za OTT (Apple TV, Netflix, HBO).
- Font: **Inter Tight** (duh SF Pro / Apple TV). Alternative: Figtree (Netflix Sans), Outfit (Max/Disney+), Geist. Svi su OFL, licence su u `_src/fonts/`. Netflix Sans, SF Pro i Max fontovi su vlasnički i ne smeju se koristiti.
- `klaro-k2.html/.png`, izvor `_src/build_k2.py`, fajlovi `concepts/klaro-k2/`. Geometrija je 1:1 iz Inter Tight Bold K (otvor: (410,1490) (410,833) (430,833) (966,1490); krak: (430,833) (966,1490) (1343,1490) (791,823)), mapirana tako da otvor ide tačno od ivice (L=140) do dna tamnog panela (H=336).
- K1 Krak K (beli centar = gornji krak) · K2 Krilo K (beli centar = otvor K) · K3 Krilo K, meko. Plus lockup, studija fontova i animacija.

## Uspravno + jasniji tamni deo (29. 9. 2026)
Vlasnik: K3 je dobar, ali treba uspravan (bez nagiba), kao slova u imenu. Tamni gornji levi deo deluje nedefinisano; možda pomeriti/centrirati da liči na krov ili play.
`klaro-upright.html/.png`, izvor `_src/build_upright.py`, fajlovi `concepts/klaro-upright/`. Svi su uspravni, beli otvor je 1:1 iz Inter Tight Bold K.
- U1 K3 uspravno · U2 Stub · U3 Krov · U4 krov u pravcu kraka · **U5 dva ista panela okrenuta za 180°, beli pojas = krak K (50,8°, debljina 0,196 visine)**; simetrično i najodređenije.

## „Klaro“ = jasnoća, spin na U5 (29. 9. 2026)
Vlasnik je pitao kako AI doživljava reč „klaro“ (njemu: čistoća, jasnoća) i tražio taj spin na nešto dobro iz prethodnih pokušaja.
Tumačenje: claro/chiaro/klar/clarus = jasno, bistro, svetlo; „klaro!“ = naravno. Spin: tamo gde se ekrani spoje, sve postaje jasno.
`klaro-clarity.html/.png`, izvor `_src/build_clarity.py`, fajlovi `concepts/klaro-clarity/`.
- C1 Prozirnost (paneli se preklapaju kao staklo; presek = krak K u svetloj boji Clear #8FD8FF; u jednoj boji presek je beli rez = U5)
- C2 Svetlo (beli krak kao linija svetla, sjaj na tamnom)
- C3 Staklo (app ikona sa dva staklena panela, Liquid Glass; ravna verzija je C1)

## Staklo: simetrija + spin (29. 9. 2026)
Vlasnik: sredina C3 ne deluje simetrično; traži blagi spin, „još malo više“.
- Geometrija je bila tačno 180° simetrična (razlika 0). Utisak je kvarila senka sa dy=6, vertikalni prelaz na panelima i oštri 90° uglovi na krajevima preseka. Sada: centrirana senka, radijalno svetlo iz centra i isto zaobljeni krajevi preseka.
- `klaro-glass.html/.png`, izvor `_src/build_glass2.py`, ikone 1024 u `concepts/klaro-glass/`: G0 simetrija ispravljena · G1 svetlo iznutra · G2 zrak · G3 dubina.

## Povratak na reference: B sa gradijentom + C (29. 9. 2026)
Vlasnik (uz `klaro-refs.html`): „C1 i C2 nisu loši. B1 i B2 su isto dobri, ali mora da ide gradijent iz jedne boje u drugu.“ Radi se po logo-design skill-u (audit, test-list, tabla koncepata).
- Tabla koncepata: `klaro-gradient.png/.svg`; izvor `_src/build_gradient.py` (geometrija iz `build_refs.py`, sada može da se importuje); fajlovi `concepts/gradient/` (light, dark, lockup; `b-mono.svg` = jedna boja sa razmakom duž spoja).
- **G1 Tok** (preporuka): ceo znak prelazi iz navy u plavu (−45°), plavi panel kreće stepen svetlije, pa se paneli i dalje razdvajaju · **G2 Dva ista**: isti prelaz na oba panela · **G3 Predaja**: ravni paneli, prelaz samo na preklopu (Jira princip).
- Odbačeno pri izradi: stepenasti prelaz (4 trake; šavovi i nemir) i C sa gradijentom (mutno na krugu). C1/C2 ostaju ravni.
- Font u lockupima: Inter Tight Bold/Regular (odluka iz K2 kruga).
- Testovi (`_internal/gradient-preview.html`): 16 px čitljivo; sivi ton razdvaja panele; na tamnoj podlozi navy nestaje, pa tamna verzija kreće od #DCE8FF; u jednoj boji paneli se stapaju, zato postoji `b-mono.svg` sa razmakom. Rizik B: okrenut/ogledalo čita se kao N/Z. Rizik C: K od delova u navy/plavoj je porodica Kodi (vidi odbijanje B/C gore).
- Master za štampu ostaje ravna dvobojna verzija (B1) + jednobojna; gradijent je digitalna verzija.

## 3D: ekran 1 teče u ekran 2 (29. 9. 2026)
Vlasnik (na G1): „tok ide iz gornjeg (1) u donji (2); dva ekrana, jedan spojen u drugi, kao 3D, a ne 2D.“ Dodatno: „ikona mora suptilno da kaže da je TV/OTT media player: macOS taskbar, Windows ikona, Smart TV i store, Fire TV, svuda.“
- Konstrukcija: `_src/build_flow3d.py`. Traka se gradi u 3D i projektuje: ekran 1 (y=0) ide nadole, pregib ka napred (pod), ekran 2 (y=D) ide nadole. Boja teče duž trake od Blue (vrh ekrana 1) do Navy (dno ekrana 2); plohe okrenute nagore su posvetljene (jedan izvor svetla).
- Ekrani su 16:9 (W 320, H 180), što je TV znak i format TV banera. Pogled je blag: ekrani su okrenuti 15° (`set_view(15, (-0.62, 0.36))`), jer je izometrija od 30° davala uzak i visok znak.
- Suptilan znak playera: traka napretka na ekranu 2 (62 %). Ispod 64 px se izostavlja (`*-small.svg`). Mali play na ekranu 1 je odbačen: u 3D je iskošen i ne čita se (a play je ranije odbijen).
- A **Tok** (zaobljen pregib, D 130, r 45) · B **Pregib** (oštar, D 100). Fajlovi `concepts/flow3d/` (light, dark, lockup, ice/night ikone, small).
- Tabla platformi: `klaro-flow3d.html/.png` (izvor `_src/build_platforms.py`): macOS Dock, Windows 11 taskbar 24 px i naslovna traka 16 px, TV launcher 16:9 baner (Android/Google TV, Fire TV), Samsung/LG kvadratne ikone, prodavnica. Tuđe aplikacije su neutralna siva polja. Pregled koncepata: `klaro-flow3d-concepts.png`.
- Rizici: A može da se pročita kao savijen papir ili zastava; B kao laptop ili police. Audit (67–74) javlja mnogo tonova (trake na pregibu), gradijente i belu traku preko boje. To je u redu za koncept; u kompletu idu ravna i jednobojna master verzija, pregib kao 2–3 ravna tona i slojevi za tvOS parallax i Icon Composer.

## 3D krug odbijen (29. 9. 2026)
Vlasnik: „odvratno. bukvalno praviš sve gore i gore.“ Prelazi na Codex po predlog.
**Pouka:** 3D traka (senčenje, savijen list, traka napretka) je otišla daleko od onoga što mu se svidelo. Poslednje što mu se dopalo: ravni B1/B2 (dva panela spojena preklopom) i C1/C2 (krug isečen u K) iz `klaro-refs.html`, jedino uz zahtev za prelaz navy ↔ plava. Ideja „1 teče u 2“ je njegova; nije loša, ali ju je izvedba ubila.

## In Sync krug (30. 9. 2026)
Vlasnik je poslao svoju AI tablu „Refined core mark“ (dva kosa panela Navy + Blue, plavi se preliva preko ramena tamnog; lockup, app ikona, jedna boja, motion „separate → connect → in sync“) i brief: tri pravca, preporuka, stop.
- Jezgro = njegov znak, tačno nacrtan: paneli sa vertikalnim stranama i ivicama pod 30°, plavi pomeren tako da mu je donja ivica ista dijagonala kao gornja ivica tamnog; „most“ = horizontala tangentna na vrh luka tamnog panela. Oštri uglovi R 0,25 W, tupi R 0,10 W. Izvor `_src/build_sync2.py`, fajlovi `concepts/sync2/`.
- **A In Sync** (preporuka, ravno dvobojno) · **B Flow** (prelaz u svakom panelu, boja teče iz gornjeg u donji) · **C Split** (razmak 0,045 W duž spoja; ista geometrija kao jednobojna verzija).
- Pregled: `klaro-sync2-concepts.png`. Audit 91 (A, C), 83 (B, gradijenti). Veliki broj tačaka je od lukova izlomljenih u linije; u kompletu idu pravi `A` lukovi.

## A odobren → pun komplet + TV spin (30. 9. 2026)
Vlasnik: „A, napravi pun komplet, ali i jedan spin koji malo više asocira na TV ekrane, isto flow i sync.“
- Master geometrija sa pravim lukovima: `_src/klaro_sync.py` (`Spec`: A i TV), 18 tačaka, audit 100/100. Jednobojna verzija: plavi odmaknut 0,045x, oštar vrh od 30° (kao njegova tabla 04).
- Komplet: `kit/` (88 fajlova, izvor `_src/build_kit.py`): logo (znak, horizontalni, sa sloganom, složeni, samo ime × colour/dark/mono), web/iOS/Android/TV/desktop ikone, `BRAND-GUIDELINES.md`, vodič na jednoj strani `klaro-brand-guide.html/.png` (`_src/build_guide.py`).
- Font u lockupu: Inter Tight 700/400, slogan 500.
- **TV spin**: paneli su tačni 16:9 ekrani u izometriji (H = 0,6495x), pomak 0,5x, uglovi R 0,15x / r 0,06x. Poređenje: `klaro-tv-spin.png` (`_src/build_tv_spin.py`), masteri u `concepts/tv-spin/`. Ako pobedi: `python3 _src/build_kit.py --spec tv` → `kit-tv/`.

## Krug 2026: stakleni K + RGB (30. 9. 2026)
Vlasnik: „napravi logo moderan, 2026, malo glassy, sa slovom K, ali ubaci neki RGB fazon ili moderni shine da se prepozna da je Klaro.“ (In Sync komplet u `kit/` ostaje netaknut.)
- Oblik: mekan K od tri zaobljena poteza, spojen u jedan komad (`_src/kglass_geom.py`, `pill_k(join=0.66, split=0.30)`). Nije sastavljen od delova, zbog Kodi-ja.
- **A Clear** (preporuka): providno staklo; stub = R, gornji krak = G, donji krak = B, belo na spoju · **B RGB**: tri kanala sabrana u beli K (na svetloj podlozi Navy K sa R/B ivicom) · **C Shine**: Klaro plavi stakleni K + spektralni odsjaj preko spoja.
- Tabla: `klaro-kglass.html/.png` (`_src/build_kglass_board.py`); ikone 1024 u `concepts/kglass/` (Chrome render, filteri i blend modovi), izvor `_src/build_kglass.py`. Ravna verzija u jednoj boji: `concepts/kglass/k-flat-*.svg`.
- Rizici: B podseća na TikTok efekat; C (plavi K) je u OTT kategoriji blizu Kodi-ja; A na 16 px prelazi u svetli višebojni K.

## Razrada A: RGB kao aura (30. 9. 2026)
Vlasnik: „razradimo K iz A, ali umesto RGB u slovu, neka bude kao aura oko ili ispod/iznad.“
- K je čisto staklo (belo, blago zamućeno, svetla ivica); R/G/B su zamućeno svetlo van slova. `_src/build_kaura.py`, ikone 1024 u `concepts/kaura/`, tabla `klaro-kaura.html/.png`.
- 1 Aura oko (prati obris: stub R, gornji krak G, donji krak B) · **2 Aura ispod** (preporuka: ambijentalno svetlo iza TV-a) · 3 Aura iznad (izlazak sunca) · 4 Svetlosni obod (tanka RGB ivica; blisko Apple Intelligence sjaju).
- Tehnički: blur filteri moraju imati `filterUnits="userSpaceOnUse"` sa punim platnom, inače se aura seče u ravnu liniju.

## Razrada 1 (aura oko) i 4 (svetlosni obod) — po 4 varijante (30. 9. 2026)
Tabla `klaro-kaura2.html/.png`, izvor `_src/build_kaura2.py`, ikone `concepts/kaura2/` (dark/light 1024; za 1c i 4b i `-dark-small` bez natpisa).
- 1a Meka aura · 1b Neon (tik uz staklo, najjači na 16–32 px) · 1c Ambijent + PLAYER · 1d Spektar (6 boja)
- 4a Sjajni obod · 4b Tanka linija + PLAYER · 4c Svetlo iznutra · 4d Kometa (svetlo na delu ivice, za animaciju)
- PLAYER: Inter Tight 620, velika slova, razmak 0,42 cap, pretvoreno u krive; čitljivo do ~120 px, a od 64 px naniže ide verzija bez natpisa.

## 1d Spektar razrada + PLAYER stilovi (30. 9. 2026)
Vlasnik: „nastavimo sa 1d, spektar iza se može lepo animirati da bude živ; par varijanti sa PLAYER ispod; 1c isto nije loš.“
- Izvor `_src/build_kaura3.py`; statične ikone `concepts/kaura3/` (dark/light), žive SVG ikone `1d-live.svg` i `1d-p1-live.svg` (SMIL: 6 boja kruži za 8 s, aura „diše“ 4 s).
- Animacija: `klaro-spektar-live.mp4` (8 s) i `.gif` (360 px); kadrovi u `_internal/kaura3-frames/`.
- Spektar: 6 dilatiranih kopija K (R, Y, G, C, B, M) na orbiti 66 (za K od 520), dilatacija 16, blur 30; staklo bez tinta (frost .99/.96), pa je K beo.
- PLAYER: P1 razmaknuta velika slova (620) · P2 „Player“ obična slova, veće (560) · P3 velika slova u spektru · P4 staklena kapsula. Plus 1c sa P1. Ispod 64 px ide K bez natpisa.
- Tabla: `klaro-spektar.html/.png`.

## ODOBRENO: 1d Spektar + P1 → pun komplet v2.0 (30. 9. 2026)
Vlasnik: „slažem se, neka ide 1d sa P1“.
- Stari In Sync komplet je premešten u `archive/in-sync/` (kit + TV spin tabla). `kit/` je sada Spektar.
- Jezgro: `_src/klaro_spektar.py`. K = `pill_k(join=0.70, split=0.353)`: krak i noga su ispravljeni na tačnih 45° (bilo je 42,6°, audit „near-miss angle“); vizuelno isto.
- Fajlovi: `_src/build_kit_spektar.py` → `kit/` (logo: znak, horizontalni, složeni, ime × dark/light/mono; ikone app/iOS/Android/TV/desktop/web). Tamna podloga = beli stakleni K + screen aura; svetla = Navy K + normal aura 72 %.
- Pokret: `_src/build_motion_spektar.py` + `motion_frames.mjs` (Playwright iz `node_modules/.pnpm/playwright@1.58.2`, `channel: chrome`) → `kit/motion/` (loop 1080 8 s, loop-small, intro 1920×1080 5 s, GIF, žive SVG ikone).
- Vodič: `_src/build_guide_spektar.py` → `kit/klaro-brand-guide.html/.png`; pravila u `kit/BRAND-GUIDELINES.md`.
