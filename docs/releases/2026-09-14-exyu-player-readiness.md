# EXYU Player: ispravke i spremnost za reklamiranje — 14.09.2026.

Pripremljen je lokalni web paket na grani `codex/exyu-marketing-fixes-20260914`, izveden iz potvrđene aktivne produkcije `602e09d`. Paket nije deploy-ovan. Produkcija je tokom audita i dalje `20260908T190000Z-602e09d`; potvrđeni su javni release marker i web/proxy symlink-ovi. Stariji, izmenjeni glavni checkout nije korišćen kao deploy izvor.

## Šta je popravljeno

- **MP2 uživo i TV unazad:** plejer zadržava sliku i jasno prikazuje „Zvuk nije dostupan: ovaj sadržaj koristi MP2 audio, koji web plejer ne podržava. Slika se reprodukuje bez zvuka.” Arhiva sada koristi istu detekciju kao live. U arhivi se MP2 uklanja iz lokalnog TS toka pre postojećeg poravnanja vremenskih oznaka; kombinacija obe transformacije je proverena. Nema transkodiranja niti izmene upstream izvora. Detekcija zavisi od čitljivog TS probe segmenta; HEVC video i dalje zahteva podršku uređaja.
- **MP2/Cast UX:** običan izbor kanala više ne otvara veliko Cast obaveštenje preko slike. MP2 zaštita važi za live i arhivu; razlog ostaje na Cast kontroli i pri eksplicitnoj Cast akciji. AAC kanal uklanja MP2 poruku.
- **Povratak iz pozadine i promena kanala:** zaustavljena ili zamenjena reprodukcija ne može naknadno da oživi stari izvor tokom oporavka. Prekinuti HLS startup završava svoj Promise; takvo otkazivanje se ne prijavljuje kao novi kvar provajdera. Ovo rešava potvrđenu trku u kodu, bez tvrdnje da su svi zabeleženi idle/decode događaji imali isti uzrok.
- **iPhone fullscreen:** kada native fullscreen odbije zahtev ili video još nije spreman, slika nastavlja preko celog prozora sa kontrolama plejera. Izlaz vraća običan prikaz. To je full-window fallback, ne dokaz da je browser sakrio svoj toolbar.
- **SSO:** posebne poruke za previše pokušaja, nevažeći link, odbijen TV nalog, neaktivnu pretplatu i nedostupan server. Exchange ima 15-sekundni timeout. Eksplicitno odbijen nalog zaustavlja staru sesiju i briše stare TV kredencijale umesto tihog povratka na drugi keširani nalog.
- **Tačniji crash brojevi:** očekivana odbijanja pristupa i rate limit ostaju događaji, a ne novi strukturirani crash zapisi. Dokazano extension-only izuzeci ostaju dijagnostička upozorenja. Mešoviti/app stack-ovi, React boundary, stvarne playback/catalog i server greške ostaju u izveštavanju. Istorijski zapisi nisu brisani ili prepravljani.

## Pregled svih dostupnih prijava od poslednjeg potvrđenog release-a

Baza: **08.09.2026. 19:10 UTC – 14.09.2026. 13:08:22 UTC**. Učitano svih **35/35 feedback**, **130/130 crash** i **399/399 filtriranih error događaja**, sa paginacijom. Deo sesija je na starijim avgustovskim build-ovima; nisu sve greške automatski regresije aktivnog septembarskog build-a. Brojevi ispod su zapisi/događaji, ne broj ljudi.

35 prijava dolazi iz 25 sesija i 12 pseudonimizovanih identiteta:

| Kategorija | Broj |
| --- | ---: |
| Nema zvuka | 22 |
| Kanal ne radi | 6 |
| Buffering | 3 |
| Audio/video sinhronizacija | 1 |
| VOD ne radi | 1 |
| Pogrešan EPG | 1 |
| Ostalo | 1 |

Najviše prijava je za PINK FOLK 2 (11), ELITA 4 (7), PINK FOLK 1 (5) i ELITA 3 (5). MP2 je potvrđen u telemetriji i odgovara velikom delu problema sa zvukom, ali tekst „nema zvuka” sam po sebi nije dokaz kodeka za svaku prijavu. Prijave o nedostajućem ELITA programu, EPG-u i info-kanalu zahtevaju poređenje konkretnog prava pristupa i kataloga; nisu označene kao rešene ovim paketom.

130 crash zapisa dolazi iz 102 sesije i 28 pseudonimizovanih identiteta:

| Vrsta zapisa | Broj | Tumačenje |
| --- | ---: | --- |
| TV nalog odbijen | 58 | Problem pristupa, ne JS rušenje |
| SSO rate limit 429 | 14 | Previše pokušaja |
| Neaktivna pretplata | 9 | Očekivano ograničenje pristupa |
| SSO 401 | 2 | Nevažeći/istekli link |
| SSO HTTP 502 | 12 | Stvarna greška servera/gateway-a |
| Playback | 27 | 16 decode, 6 opštih, 4 mrežne, 1 otkazano učitavanje |
| Katalog | 5 | 3 HTTP 502, 1 timeout, 1 neočekivan API format |
| TypeError u Chrome ekstenziji | 3 | Isti extension stack u jednoj sesiji |

Dakle, **83 od 130** su odbijanja pristupa/rate limit, a **3** pripadaju ekstenziji. Preostalih **44** su playback, katalog i SSO/server greške. U ovoj grupi nije dokazan zaseban globalni JS crash iz EXYU aplikacionog bundle-a. To ne isključuje druge moguće greške van dostupnih podataka. Dodatno je pronađeno **13 fullscreen error događaja na iOS-u**, sa `InvalidStateError`.

## Proxy i analytics stanje

Proxy journal je zadržao samo **11.09. 13:25 UTC – 14.09. 13:08 UTC**, pa iz njega ne može da se rekonstruiše ceo period od 08.09. U zadržanom intervalu: 3.048 izbora izvora, 2.840 uspešnih manifesta, 2.089 playback.started događaja, 114 playback.error događaja, 557 MP2 upozorenja i 297 catchup.stall događaja. Ponovljeni pokušaji i upozorenja nisu jedinstveni kvarovi. Za 49 uspešnih catchup.first_frame uzoraka medijana je 3,934 s, p95 10,925 s; to nije SLO niti distribucija svih pokušaja.

Svih 19.979 zabeleženih analytics forward zahteva dobilo je HTTP 200. To dokazuje prijem tih zahteva, ne ispravnost svakog dashboard agregata. Proxy je aktivan; NRestarts=0 odnosi se samo na period posle restarta 11.09. oko 04:30 UTC. Uptime timer je aktivan i uključen.

**Sedmodnevni panel pregled trenutno nije pouzdan.** Tačan poziv sa panel servera istekao je posle 40 s; lokalni app-server poziv davao je 503/timeout. Jednodnevni pregled je odgovorio 200 za oko 4,5 s. Log rute potvrđuje PostgreSQL `57014` u paginiranom čitanju događaja. Ingest i pregled su zato odvojeni problemi.

SQL kandidat je u posebnoj grani `codex/player-analytics-indexes-20260914`, u `scripts/sql/player-analytics-overview-indexes-20260914.sql`, sa pratećim uputstvom za proveru/rollback. Dva indeksa čuvaju filter i sve podatke. Lokalna PostgreSQL 14 provera na 600.000 sintetičkih redova, offset 50.000, potvrdila je identične rezultate i prelazak na indeks; medijana pet ponavljanja bila je 226,958 ms pre i 22,063 ms posle. Prvi hladni pokušaj nije bio brži; performanse zavise od cache-a i opterećenja. Produkciona korist još nije potvrđena.

Živi indeksni katalog nije pročitan: postojeća Supabase CLI autentikacija vraća 401. Nije primenjen SQL. Pre primene treba proveriti da ekvivalentni validni indeksi već ne postoje. Ako već postoje ili ne otklone timeout, sledeća ciljna izmena je zamena duboke OFFSET paginacije cursor čitanjem/SQL agregatima. Cela EXYU Next.js aplikacija se ne deploy-uje iz te SQL grane.

## Verifikacija kandidata

- 511/511 unit testova, svih 65 datoteka; proxy listen testovi izvršeni uz dozvoljen lokalni port.
- Lint svih paketa i sva tri typecheck-a prolaze. Korišćene su direktne workspace komande jer Turbo wrapper pada u ograničenom macOS okruženju.
- Release guardrail testovi: inicijalno 192/194; dva pada bila su zbog stare tekstualne MP2/live pretpostavke u Cast validatoru. Pravilo je usklađeno sa proširenom zaštitom, zatim oba pogođena test fajla prolaze (6/6). Svi slučajevi su pokriveni uspešnim proverama. Postojeće final-device/owner gate zahteve nismo označili kao završene.
- Produkcione zavisnosti: pnpm audit prijavljuje 0 ranjivosti u 154 produkcione zavisnosti prema tada dostupnoj bazi advisories.
- Proxy i push-api build prolaze; web produkcioni build prolazi sa EXYU konfiguracijom. Lokalni kopirani `.env.production` imao je prazan proxy origin; build zaštita ga je odbila. Za kandidat je postavljen `https://player.exyu.tv`. Produkciono okruženje nije menjano.
- Chromium: MP2 live, MP2 catchup sa i bez client rebase, AAC catchup sa rebase. Prava sintetička HLS/TS slika napreduje, MP2 nema audio decode bajtove, AAC ima dekodiran audio; bez adapter grešaka u ovim proverama.
- Mobilni raspored 390×844: MP2 poruka, odsustvo automatskog Cast popupa, promena na AAC bez zaostale poruke, iPhone native-fullscreen rejection simulacija, Escape povratak, film iz biblioteke do prve slike. Ovo je emulacija, ne fizički iOS/Android dokaz.
- Browser SSO: 429, 502, odbijen nalog sa starim keširanim kredencijalima, mrežni timeout. Svaki scenario prikazuje odgovarajuću poruku, sklanja token i ne vraća odbijeni stari nalog.
- QA mediji i fixture reference nisu u `dist`; `.env.production` nije deo patch-a. `git diff --check` prolazi.

## Pre snažnijeg reklamiranja

1. Odobriti i objaviti ovaj web paket iz izolovane grane, sa rollback-om na `20260908T190000Z-602e09d`. Proxy kod nije menjan; web-only deploy je dovoljan za ovaj paket. Uporediti aktivni marker i web symlink sa novim commit-om.
2. Proveriti i po potrebi primeniti analytics SQL, zatim tri uspešna puna sedmodnevna pregleda kroz pravi panel, bez novih 57014 i bez gubitka prijema.
3. Na stvarnom iPhone-u/Safari i Android/Chrome: aktivna EXYU prijava, običan kanal, MP2 slika/poruka, arhiva sa seek-om i povratkom uživo, film nastavak od zapamćenog vremena, fullscreen i background povratak. Testirati i desktop Chrome/Safari. Lokalni rezultat ne zamenjuje ove provere.
4. Pratiti prvi manji talas stvarnih korisnika: vreme do slike, uspešni početci, oporavci, konačne playback greške i prijave zvuka. HTTP 502, problemi pristupa i pogrešan katalog/EPG ostaju vidljivi i zahtevaju rad na odgovarajućem backend/gateway/izvoru.

Ovaj paket je proveren lokalni kandidat. Široku kampanju ne treba označiti spremnom dok produkcioni analytics i provere na stvarnim uređajima ne prođu.
