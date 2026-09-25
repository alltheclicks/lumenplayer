# Lumen / EXYU player — kandidat za zajedničko izdanje, 8. septembar 2026.

Izolovana grana `codex/lumen-audit-fixes-20260908`, osnova `186e966`. Web kod te osnove odgovara objavljenom `7dde6b5`; razlika je ranija ispravka uptime-monitor skripte. Originalni radni direktorijum i njegovi nezavršeni radovi nisu menjani. Greptile je preskočen po izričitom zahtevu vlasnika. Ovaj dokument opisuje lokalni kandidat, ne potvrdu objavljivanja.

## Sadržaj izdanja

| Nalaz iz pregleda | Pripremljena ispravka |
|---|---|
| 1 — mobilni VOD/Serije bez vidljive slike | Kontrole su ispod slike. U fullscreen-u se skrivaju nakon 3 s reprodukcije i ponovo prikazuju na dodir/pokret. Ostaju dostupne na pauzi, pri radu sa zvukom i fokusu tastature. |
| 11 — povratak na početak epizode/filma | Pozicija se pamti na uređaju, odvojeno po nalogu i serveru. Detalji nude „Nastavi od…” i „Od početka“. Obnova čeka metadata događaj umesto da početni timeupdate sa 0:00 prepiše sačuvanu poziciju. |
| 12 — godina dodavanja prikazana kao godina filma | Prednost ima release metadata, zatim godina u zagradi na kraju naslova. Ako godina nije poznata, prikazuje se „Film“; `added` se više ne koristi za godinu. |
| 14 — dugme za gledanje duboko ispod ekrana | Manji poster na telefonu; gledanje filma odmah uz naslov, izbor epizoda ispred dužeg opisa i metapodataka. |
| 15 — mešani nazivi | Ujednačeni nazivi u VOD/Serije detaljima, kontrolama i navigaciji; EXYU naziv u naslovima kataloga. Ovo nije potpuna lokalizacija svih stranica aplikacije. |
| 16 — prelazak na sledeću epizodu | Prethodna/sledeća dostupna epizoda, uključujući prelaz sezone. Po završetku sledeća kreće ako je postojeća opcija automatskog puštanja uključena. Bez kruženja posle poslednje. |
| 17 — prijava uvek polazi od TV kanala | Opcije „Film ili epizoda ne radi“ i „Nema slike“, smislen početni izbor i pravilno pokretanje predloga pri otvaranju forme. Produkcioni ingest prihvata ove kategorije bez migracije. |
| 18 — bezimena dugmad | Dodati pristupačni nazivi za kontrole slike/zvuka, zapping, omiljene, fullscreen i mobilnu navigaciju. |
| 19 — VOD zavisi od TV kataloga | Učitavanje i greška live kataloga više ne uklanjaju VOD/Serije player. Neuspešno osvežavanje takođe ne uklanja postojeću listu kanala. |
| 20 — prethodni TV kanal u prijavi epizode | Odvojen kontekst sadržaja; novi izvor resetuje kanal i čuva naziv, ID, sezonu i epizodu u dijagnostici. |

Dodato je i odvajanje callback-a za kraj reprodukcije od životnog ciklusa video adaptera, da pristizanje sledeće epizode ne prekida trenutno gledanje.

Preflight je otkrio 6 prijavljenih ranjivosti u starim proxy zavisnostima. Kandidat podiže Fastify 5.8.5 → 5.12.1 i postojeći fast-uri override 3.1.5 → 3.1.6, uz zaključan pnpm lockfile. Izvori: [Fastify 5.12.1](https://github.com/fastify/fastify/releases/tag/v5.12.1), [fast-uri 3.1.6](https://github.com/fastify/fast-uri/releases/tag/v3.1.6). Zbog te promene kompletan paket obuhvata web i proxy, bez DB migracije. Fastify više ne prihvata samo broj proxy skokova; eksplicitno je zadržano poverenje u lokalni nginx/loopback peer uz postojeću granicu skokova. Test pokriva i odbijanje lažnog X-Forwarded-For zaglavlja od direktnog klijenta.

## Provera i ponavljanje

- `TZ=Europe/Belgrade pnpm test:unit`: 498 testova u 62 fajla. Dva postojeća testa catch-up URL-a imaju fiksno očekivanje vremena Beograda i padaju sa zonom Athens. Produkciona logika vremenskih zona nije menjana da bi testovi prošli.
- `pnpm typecheck`, `pnpm lint`, produkcioni build i audit zavisnosti; završni izlazi su u `output/playwright/audit-fixes/`.
- Chromium: 360×740, 390×844, 430×932, 844×390, 768×1024, 1440×900. Geometrija videa i kontrola, odsustvo horizontalnog prelivanja, fullscreen skrivanje/pauza/izlaz, povratak na TV i nazivi vidljivih dugmadi.
- Stvarna lokalna HLS reprodukcija: seek → pauza → detalji → reload → nastavak, zatim od početka, prethodna/sledeća epizoda i završetak epizode.
- Namerno vraćen HTTP 502 za live API: VOD nastavlja reprodukciju.
- Forma prijave šalje samo u lokalni presretač: proverene kategorije i naziv filma/epizode bez prethodnog TV kanala. Nije poslata produkciona test-prijava.
- Pozicija je lokalna za browser; nema sinhronizacije napretka između uređaja. Čuva se do 200 stavki po nalogu, periodično na 5 s i na pauzi/izlasku.

Za generisanje test-medija (sintetička slika/zvuk, bez korisničkog programa):

```sh
mkdir -p output/playwright/on-demand-media
ffmpeg -y -f lavfi -i 'testsrc2=size=640x360:rate=24' -f lavfi -i 'sine=frequency=440:sample_rate=48000' -t 90 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -g 48 -c:a aac -f hls -hls_time 6 -hls_playlist_type vod -hls_segment_filename output/playwright/on-demand-media/segment%02d.ts output/playwright/on-demand-media/index.m3u8
```

Pokrenuti lokalni EXYU build/preview i zatim:

```sh
LUMEN_QA_BASE_URL=http://127.0.0.1:5189 LUMEN_QA_MEDIA_DIR=output/playwright/on-demand-media node scripts/playwright/run-on-demand-layout-regression.mjs
LUMEN_QA_BASE_URL=http://127.0.0.1:5189 LUMEN_QA_MEDIA_DIR=output/playwright/on-demand-media node scripts/playwright/run-on-demand-flow-regression.mjs
```

Skripte odbijaju udaljene instance, sve spoljne zahteve presreću ili blokiraju, a strim i analitički identitet su testni.

## Otvoreno iz prvobitnog pregleda

Ovo izdanje ne potvrđuje rešenje upstream 502/504 kataloga, MP2 zvuka na ELITA, svih HEVC izvora, ponovljenog live/background recovery-ja, početnog vremena i zastoja TV unazad, iOS `InvalidStateError` fullscreen-a ili 503 overview analitike. Nisu popravljeni netačni provider duration podaci niti potvrđene prijave o isteku probe, konkretnom TV/Cast uređaju i PWA instalaciji. Potrebne su provere stvarnih izvora/uređaja i zasebnog EXYU backend-a.

`release:qaf035:validate` prolazi u postojećem režimu „current“, ali stari opšti Phase 1/2 finalni obrasci i dalje imaju otvorene device/provider/ops stavke. Nisu označeni kao završeni na osnovu lokalnih browser testova. Fizički iPhone/Android, TV i Cast uređaj nisu testirani.

## Aktivacija

Priprema ne menja produkciju. Za stvarno objavljivanje koristiti jedno verzionisano izdanje web-a i proxy-ja kroz postojeći staging/activation/rollback mehanizam. Sačuvati provereni commit, web i zaključani proxy artefakt i njihove SHA-256 sume zajedno. Neposredno pre aktivacije ponovo pročitati aktivne web/proxy symlink-ove i sačuvati ih kao rollback par. Ne prepisivati aktivni direktorijum na mestu i ne instalirati sveže verzije zavisnosti na VPS-u.

Posle aktivacije proveriti javni `lumen-release.txt`, `/health`, EXYU SSO, jedan live kanal i oba VOD/Serije toka. Ako osnovni tok ne prođe, vratiti oba prethodna symlink-a i restartovati proxy. Odluka o objavljivanju i preostalim stvarnim device proverama ostaje odvojena od ovog lokalnog kandidata.
