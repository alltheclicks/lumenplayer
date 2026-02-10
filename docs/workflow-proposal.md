# Predlog rada za Lumen Player (LLM-friendly + GitHub-first)

> Verzija: 1.0  
> Datum: 10. februar 2026  
> Projekat: Lumen Player

## 1) Cilj dokumenta

Ovaj dokument definise nacin rada za obiman projekat koji treba da:
- lako nastavi bilo koji LLM agent u novom chatu
- ne zavisi od jedne sesije ili memorije chata
- koristi GitHub kao glavni izvor istine
- ukljuci Greptile kao dodatni sloj kontrole kvaliteta

## 2) Kljucni principi

1. Git je source of truth.  
Sve bitno mora biti u repou: odluke, plan, status, kontekst.

2. Chat nije source of truth.  
Chat je privremena radna memorija; rezultat mora da zavrsi u fajlu, issue-u ili PR-u.

3. Mali, proverljivi koraci.  
Svaki radni korak mora imati jasan izlaz i kriterijume zavrsetka.

4. Arhitektura stabilna, backlog fleksibilan.  
Arhitekturne odluke se menjaju retko; backlog i feature specifikacije se menjaju cesto.

5. Bez vendor lock-in-a u core procesu.  
Cloud alati su dodatak, ali build/release tok mora imati fallback koji ne zavisi od jednog providera.

## 3) Dokumentaciona struktura (living system)

Obavezni fajlovi:

- `DECISION-DOC.md`  
Arhitektura, platformske odluke, sta je usvojeno i zasto.

- `CONSTRAINTS.md`  
Biznis i tehnicka ogranicenja (npr. bez lock-in-a, bezbednost, performanse, budzet).

- `ROADMAP.md`  
Faze i milestone-i sa izlaznim kriterijumima.

- `BACKLOG.md`  
Jedinstvena lista ideja, feature-a, bugova, tehnickog duga.

- `docs/features/LP-XXXX-*.md`  
Detaljna specifikacija pojedinacnog feature-a.

- `HANDOFF.md`  
Sta je poslednje uradjeno i kako sledeci agent odmah nastavlja.

## 4) Kako se dodaje nova funkcija (bez lomljenja plana)

1. Nova ideja ulazi u `BACKLOG.md` kao `idea`.
2. Ako ulazi u rad, dobija ID (npr. `LP-0123`) i status `planned`.
3. Pravi se feature doc u `docs/features/LP-0123-naziv.md`.
4. Tek onda krecu branch, implementacija i PR.
5. Nakon merge-a, azuriraju se `BACKLOG.md`, `ROADMAP.md` (ako treba), `HANDOFF.md`.

## 5) GitHub workflow (obavezan)

1. `main` protected branch.
2. Zabranjen direktan push na `main`.
3. Sve ide kroz PR.
4. Obavezni checks:
- `typecheck`
- `lint`
- testovi (unit/integration po potrebi)
- build (bar za `apps/web` u ranim fazama)
5. Obavezan PR opis sa:
- sta je cilj
- sta je menjano
- kako je testirano
- rizici/regresije
- sledeci korak

## 6) Greptile uloga (kontrola koda)

Greptile se koristi kao AI reviewer na PR-ovima:
- hvata bug-risk i regresije
- daje signal za potencijalne probleme
- ne zamenjuje obavezne CI check-ove i ljudski review

Pravilo:
- merge tek kad prodju CI check-ovi i kada su bitni review komentari obradjeni
- Greptile komentar tretirati kao input za proveru, ne kao automatsku istinu

## 7) LLM handoff protokol (najbitnije)

Posle svake sesije obavezno azurirati `HANDOFF.md` sa:
- poslednji commit hash
- kratko: sta je zavrseno
- kratko: sta je sledece
- otvoreni rizici/blokade
- fajlovi koji su source of truth za tu temu

Minimalni format:

```md
## Session YYYY-MM-DD HH:mm
- Commit: <hash>
- Done:
  - ...
- Next:
  - ...
- Risks/Blockers:
  - ...
- Source files:
  - ...
```

## 8) Task sizing (umesto vremena po minutama)

Umesto procene 30-120 min, koristiti velicine:
- `S` = jedan PR, mali i potpuno proverljiv
- `M` = 2-4 povezana PR-a (stack)
- `L` = epic, mora da se razbije pre implementacije

Pravilo:
- nijedan `L` task ne ulazi direktno u implementaciju
- svaki task mora imati acceptance criteria pre rada

## 9) Feature template (sta mora da postoji)

Svaki `LP-XXXX` doc treba da ima:

1. Problem i cilj  
2. Scope / Out of scope  
3. UX flow  
4. Tehnicki plan (paketi, adapteri, API ugovori)  
5. Reuse postojeceg (sta koristimo iz vec uradjenog)  
6. Test plan  
7. Acceptance criteria  
8. Rizici i rollback plan  

## 10) Definicija "Done"

Task je gotov tek kada:
- kod je u PR-u i prolazi check-ove
- acceptance criteria su ispunjeni
- dokumentacija je azurirana (bar backlog/handoff)
- nema otvorenih "TODO bez vlasnika"

## 11) Operativni ritam (predlog)

1. Nedeljno: roadmap i prioriteti.
2. Dnevno: biranje `S`/`M` taskova iz backloga.
3. Po PR-u: implementacija + test + update docs + handoff.
4. Na kraju dana/sesije: obavezni `HANDOFF.md` update.

## 12) Minimalni set koji treba odmah napraviti

1. `CONSTRAINTS.md`
2. `ROADMAP.md`
3. `BACKLOG.md`
4. `HANDOFF.md`
5. `docs/features/TEMPLATE.md`
6. `.github/pull_request_template.md`
7. `.github/ISSUE_TEMPLATE/feature.md`
8. `.github/ISSUE_TEMPLATE/bug.md`

## 13) Pravila za kontinuitet preko telefona/drugog agenta

Kada startujes novi chat, prvo posalji:

1. "Procitaj `DECISION-DOC.md` i `HANDOFF.md`."
2. "Radi samo sledeci task iz `BACKLOG.md`: <ID>."
3. "Na kraju azuriraj `HANDOFF.md` i navedi tacne fajlove koje si menjao."

Time svaki agent dobija isti ulaz i isti izlazni format.

## 14) Zakljucak

Za Lumen Player najbolji pristup je:
- arhitektura stabilna (`DECISION-DOC.md`)
- plan i backlog zivi (redovno azuriranje)
- GitHub PR-driven razvoj
- Greptile kao dodatni review sloj
- obavezan handoff nakon svake sesije

Ovim dobijas razvoj koji je skalabilan, proverljiv i nezavisan od jednog chata ili jednog agenta.

---

## Review i kontra-predlog (Claude Code agent, 10. feb 2026)

### Sta je dobro u gornjem predlogu

- **Git kao source of truth** — apsolutno tacno, chat je efemeran
- **HANDOFF.md** — odlican koncept za kontinuitet izmedju sesija
- **Mali, proverljivi koraci** — pravilno
- **Feature template sa acceptance criteria** — profesionalan pristup
- **Task sizing (S/M/L)** — prakticnije od vremenskih procena
- **Pravila za novi chat** (sekcija 13) — tacno ono sto treba

### Sta bih menjao/brisao

**1. Previse ceremonijalnosti za solo/mali tim**

Gornji predlog zahteva 8 obaveznih fajlova (sekcija 12) + feature doc za svaku stvar + PR template + issue template-e. Za solo developera ili mali tim, ovo usporava umesto da ubrzava.

**2. Greptile sekcija (6) je nepotrebna**

Ako se koristi, ok, ali ne treba mu cela sekcija u dokumentu o nacinu rada. To je tooling detalj, ne princip.

**3. PR-driven razvoj za solo rad je overhead**

Dok je solo rad, direktan push na `main` sa dobrim commit porukama + typecheck/lint pre push-a je sasvim OK. PR workflow ima smisla kad postoji tim ili AI review. Protected branch i PR za svaku sitnicu je trenje bez koristi.

**4. Sekcija 13 je najvazniji deo, ali nedostaje CLAUDE.md**

Umesto da se rucno kaze "procitaj HANDOFF", to treba da bude u `CLAUDE.md` fajlu u root-u projekta. Claude Code ga automatski cita na startu svake sesije — nema potrebe da se rucno salje instrukcija.

### Kontra-predlog: pojednostavljena verzija

Cilj: nastavi posle 2 dana, lako dodaj ideju, lako proveri stanje.

**Samo 4 fajla:**

| Fajl | Svrha |
|---|---|
| `DECISION-DOC.md` | Arhitektura i platformske odluke (vec postoji) |
| `CLAUDE.md` | Instrukcije za agenta — cita se automatski na startu sesije |
| `BACKLOG.md` | Lista ideja/taskova sa statusom |
| `HANDOFF.md` | Poslednje stanje, sta je sledece |

**Workflow (3 koraka):**

1. Sine ideja → dodaj red u `BACKLOG.md`
2. Hoces da radis → otvori chat, agent cita `CLAUDE.md` → gleda `HANDOFF.md` → radi sledeci task
3. Kraj sesije → agent azurira `HANDOFF.md`

**Ostalo (dodati tek kad zatreba, ne unapred):**

- `CONSTRAINTS.md` — kad se pojave realna ogranicenja
- `ROADMAP.md` — faze vec postoje u DECISION-DOC-u, poseban fajl tek kad zatreba
- `docs/features/LP-XXXX-*.md` — tek za vece feature-e koji zahtevaju spec
- PR template / issue template — tek kad postoji tim
- Greptile — konfigurisati nezavisno, ne dokumentovati kao princip rada

**Zakljucak kontra-predloga:**

Gornji predlog ima dobre ideje ali je preoptrecen procesom. Za cilj "lako nastavi, lako dodaj ideju" treba 4 fajla i jednostavan workflow, ne 8 fajlova i formalni PR proces. Proces treba da raste sa projektom — dodavati formalizam tek kad ga situacija zahteva.

---

## Dodatak: hibridni finalni predlog (Codex, 10. feb 2026)

Kontra-predlog je dobar, ali za tvoj slucaj (solo + AI agenti + Greptile) najbolji je hibrid:

- proces ostaje lagan
- handoff ostaje strog
- PR ostaje standard za promene koda (zbog AI review i cistog traga)

### Minimalni set fajlova (sada)

Obavezno drzati:

- `DECISION-DOC.md`
- `CLAUDE.md`
- `BACKLOG.md`
- `HANDOFF.md`
- `ROADMAP.md` (kratko, 1 strana)

Sve ostalo uvoditi tek kad zatreba (`docs/features`, issue template-i, itd.).

### Prakticni workflow (solo + AI + Greptile)

1. Ideja ulazi u `BACKLOG.md`.
2. Biras jedan task i pravis branch (`codex/...`).
3. Agent radi samo taj task i otvara PR.
4. Greptile + CI komentari/check-ovi se obrade.
5. Merge u `main`.
6. Na kraju sesije obavezan update `HANDOFF.md`.

### Zasto ovaj model

- Ne usporava te birokratijom.
- Ostavlja cist trag za nastavak sa telefona ili drugim agentom.
- Drzi kvalitet kroz PR + CI + Greptile, bez preterane slozenosti.

---

## Dogovoreni finalni workflow (Claude Code + Codex + Filip, 10. feb 2026)

### Usaglaseni fajlovi

| Fajl | Status |
|---|---|
| `DECISION-DOC.md` | Vec postoji |
| `CLAUDE.md` | Kreirati |
| `BACKLOG.md` | Kreirati |
| `HANDOFF.md` | Kreirati |
| `ROADMAP.md` | Kreirati (kratak, 1 strana) |

### Usaglaseni workflow (solo, lean)

1. Ideja → `BACKLOG.md`
2. Rad → direktno na `main`
3. Pre push obavezno: `pnpm typecheck && pnpm lint`
4. Kraj sesije → update `HANDOFF.md`

Branch + PR selektivno: auth, storage migracije, player adapter, veliki refactor, release.
Prelazak na "PR za sve" kad bude 2+ developera ili cesta regresija.

### Sinhronizacija izmedju uredjaja (komp + telefon)

```
Mac (lokalno, Claude Code)
    ↕  git push / git pull
GitHub (remote repo — centralna tacka)
    ↕  citanje repo-a / commitovanje
Telefon (Claude.ai app — planiranje, ideje, review)
```

- **Mac**: pun rad sa Claude Code (editovanje, build, test, push)
- **Telefon**: Claude.ai app za dodavanje ideja u BACKLOG, citanje HANDOFF-a, planiranje, diskusiju
- **Sync mehanizam**: obican `git push` / `git pull`, nista specijalno
- VS Code automatski prati lokalni git — nakon `git pull` odmah vidi promene

### Sledeci korak

Inicijalizovati Git repo, napraviti GitHub remote, kreirati dogovorene fajlove (CLAUDE.md, BACKLOG.md, HANDOFF.md, ROADMAP.md).
