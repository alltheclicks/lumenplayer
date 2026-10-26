# Klaro — nalozi, aktivacija uređaja i panel

> Datum: 5. oktobar 2026 · status: **dogovoreno, pre dizajna** · zamenjuje skicu „Phase 1 — Dashboard + Device Management“ iz `VISION.md` / `ROADMAP.md` / `BACKLOG.md` (LP-1501…1510, LP-2007)

## Obim

- Važi za **Klaro** brend: TV/box, mobilne i desktop aplikacije, PWA `klaroplayer.com` i panel.
- **EXYU.tv ostaje samo web player** (test platforma, Xtream/SSO prijava preko exyu.tv) i nije deo ovog sistema.
- Klaro ne isporučuje sadržaj. Panel upravlja **nalozima, uređajima, licencama i izvorima koje unose korisnik ili provajder**.

## Pojmovi i hijerarhija

```
Genadmin (vlasnik sistema)
 └─ Provajder ─ kupuje kredite od genadmina
     └─ Korisnik ─ nalog (email) — opciono, vidi „Uređaj bez naloga“
         └─ Uređaj ─ jedna instalacija = jedna licenca
              └─ Izvor ─ Xtream / M3U (+ EPG)
Korisnik bez provajdera = direktni Klaro korisnik (sam plaća karticom)
```

| Pojam | Značenje |
|---|---|
| **Uređaj** | Jedna instalacija aplikacije. Identitet = ID koji aplikacija generiše pri prvoj instalaciji i čuva u sigurnom skladištu platforme. **Ne koristi se MAC adresa.** |
| **Licenca** | Pripada uređaju. Rok: do datuma ili doživotno. Stanja: probna, aktivna, ističe uskoro, istekla, deaktivirana. |
| **Kredit** | Jedinica koju provajder troši na aktivaciju/produženje. **1 kredit = 1 uređaj × 1 godina; doživotna licenca = više kredita** (tačan broj podešava genadmin). |
| **Izvor** | Xtream (server + korisnik + lozinka) ili M3U URL, opciono EPG URL. Čuva se šifrovano. |
| **Aktivacioni kod (vaučer)** | Kod koji provajder generiše unapred (paket) i prodaje; unosi se na uređaju i aktivira licencu bez naloga. |
| **Kod za uparivanje** | Kratak kod `ABC-123` koji uređaj sam prikazuje; važi 10 min. |

### Dogovorene odluke

1. **1 kredit = 1 uređaj × 1 godina.** Doživotna licenca = 2–3 kredita (konfiguriše genadmin, može po provajderu).
2. **Prodaja kredita: samo genadmin → provajder.** Sub-provajderi kasnije (model treba da ih dozvoli bez migracije: provajder ima opcionog „roditelja“).
3. **Direktni korisnici:** 7 dana probno, zatim plaćanje karticom po uređaju (godišnje / doživotno).
4. **Izvor unose oba:** provajder dodeljuje izvor svom korisniku (korisnik ga ne menja); direktni korisnik dodaje svoj.
5. **Uređaj bez naloga je dozvoljen:** vaučer od provajdera aktivira uređaj direktno; nalog se pravi tek ako korisnik želi panel.
6. **Jedan panel** na `panel.klaroplayer.com`; meni i prava zavise od uloge. (`app.klaroplayer.com` ostaje PWA player — rešava konflikt `VISION.md` ↔ `SESSION-ARCHITECTURE.md`.)

## A. Player — aktivacija i stanje uređaja

### Tokovi

- **TV / box (bez kucanja):** prvi start → ekran sa kodom `ABC-123`, QR kodom i adresom `klaroplayer.com/tv` → korisnik skenira QR ili otvori adresu, prijavi se i potvrdi uređaj (ili provajder upiše kod u svom panelu) → TV sam prelazi na „Povezano“ i učitava dodeljeni izvor.
- **Vaučer:** „Imam aktivacioni kod“ → unos daljinskim (tastatura na ekranu) → licenca aktivna, izvor od provajdera.
- **Telefon / tablet / računar:** prijava emailom (lozinka ili link na email); uređaj se sam vezuje za nalog. Alternativa: isti kod/QR tok.
- **Direktni korisnik bez izvora:** posle povezivanja → „Dodaj izvor“ (na TV-u preporuka: dodaj ga sa telefona u panelu).

### Ekrani i stanja (za dizajn)

| # | Ekran | Sadržaj |
|---|---|---|
| A1 | Dobrodošlica | Klaro intro animacija, „Počni“ |
| A2 | Kod za uparivanje | veliki kod, QR, `klaroplayer.com/tv`, odbrojavanje 10 min, „Novi kod“, „Imam aktivacioni kod“ |
| A3 | Čekamo potvrdu | kod ostaje, animacija čekanja, „Potvrdi na telefonu“ |
| A4 | Povezano | naziv naloga / provajdera, licenca do, izvor, „Kreni“ |
| A5 | Unos vaučera | polje + tastatura na ekranu, greška „kod ne važi / već iskorišćen“ |
| A6 | Prijava (mobilni/desktop) | email, lozinka ili link na email, „Imam kod sa TV-a“ |
| A7 | Licenca istekla | ko produžava (provajder + kontakt, ili „Produži“ za direktne), kod uređaja za podršku |
| A8 | Uređaj deaktiviran | razlog ako postoji, kontakt, „Poveži ponovo“ |
| A9 | Nalog suspendovan | kontakt provajdera |
| A10 | Izvor nije dodeljen | uputstvo kako da se doda (panel, QR) |
| A11 | Limit uređaja | spisak uređaja na nalogu, „Zameni uređaj“ |
| A12 | Bez interneta | radi još X dana na sačuvanoj licenci; baner, ne blokira |
| A13 | Opcije → Ovaj uređaj | ID uređaja, naziv, licenca do, provajder i kontakt, verzija, „Odjavi uređaj“ |

Uređaji: TV 1920, mobilni 390, tablet 1024, desktop 1440. Tema tamna/svetla, Klaro paleta.

## B. Panel — korisnik

- **Nalog:** registracija/prijava (email + lozinka ili link na email), profil, promena lozinke, odjava sa svih uređaja.
- **Uređaji:** spisak (naziv, tip, poslednja aktivnost, izvor, licenca do); dodaj uređaj (kod sa TV-a); preimenuj; ukloni; **zameni uređaj** (prebaci licencu na novi uređaj — ograničen broj puta godišnje).
- **Izvori:** dodaj Xtream/M3U/EPG, dodeli uređajima. Izvor od provajdera je zaključan (samo prikaz).
- **Licenca i plaćanje** (samo direktni): status probnog perioda, produži karticom (godišnje / doživotno), računi.
- **Podrška:** kontakt provajdera ili Klaro.

## C. Panel — provajder

- **Pregled:** aktivni uređaji, ističu u 7 / 30 dana, stanje kredita, nove aktivacije (grafikon).
- **Korisnici:** napravi / pozovi emailom, pretraga, detalj (uređaji, izvor, istorija), produži, suspenduj, beleška.
- **Uređaji:** aktivacija upisom koda sa TV-a (korisnik + izvor + trajanje → potrošnja kredita prikazana pre potvrde), produženje, deaktivacija, reset, grupne akcije („produži sve koji ističu“).
- **Izvori / serveri:** adresa servera se unosi jednom; po korisniku samo korisničko ime i lozinka.
- **Krediti:** stanje, kupovina od genadmina, istorija (svaka promena sa razlogom i ko ju je uradio).
- **Aktivacioni kodovi:** generiši paket (broj, trajanje), izvoz CSV, status (neiskorišćen / iskorišćen / poništen).
- **Brending (white-label lite):** logo, ime, kontakt podrške — prikazuju se u playeru njegovim korisnicima.
- **Tim:** dodatni nalozi (uloge: vlasnik, podrška).

## D. Panel — genadmin

- **Pregled:** prihod, prodati/potrošeni krediti, aktivni uređaji, po provajderu.
- **Provajderi:** otvori / odobri / suspenduj, cena kredita i cena doživotne licence po provajderu, **„Prijavi se kao“** (za podršku, beleži se u dnevnik).
- **Krediti:** dodela, prodaja, ručna korekcija (obavezna napomena).
- **Globalna pretraga:** kod, ID uređaja, email, vaučer.
- **Planovi i cene** za direktne korisnike: trajanje probnog perioda, cene.
- **Aplikacija:** obaveštenja u playeru, obavezno ažuriranje (minimalna verzija po platformi), feature flagovi.
- **Dnevnik i bezbednost:** ko je šta i kada uradio; blokada uređaja / naloga.

## Prava po ulozi (sažetak)

| Radnja | Korisnik | Provajder | Genadmin |
|---|---|---|---|
| Svoji uređaji: dodaj / preimenuj / ukloni | ✓ | ✓ (za svoje korisnike) | ✓ (svi) |
| Izvor: dodaj / izmeni | ✓ (samo direktni) | ✓ | ✓ |
| Aktiviraj / produži licencu | plaća karticom (direktni) | troši kredite | ✓ bez kredita |
| Generiši vaučere | — | ✓ | ✓ |
| Krediti: kupi / vidi istoriju | — | ✓ (svoje) | ✓ (svi, korekcije) |
| Provajderi, cene, planovi | — | — | ✓ |
| Obaveštenja, minimalna verzija, flagovi | — | — | ✓ |
| „Prijavi se kao“ | — | — | ✓ |

## Tehničke smernice (za implementaciju posle dizajna)

- Licenca na uređaju = **potpisan token** (kratko trajanje + osvežavanje); aplikacija radi offline do isteka grace perioda (A12).
- Kod za uparivanje: 6 znakova bez dvosmislenih slova (bez 0/O, 1/I), TTL 10 min, rate limit po IP-u i uređaju.
- Kredit se nikad ne menja „u mestu“: svaka promena je zapis u knjizi (ledger), stanje = zbir.
- Izvori (lozinke) šifrovani u bazi; panel ih ne prikazuje u celosti.
- API verzionisan (`/v1/…`) od prvog dana (invarijanta I-5 iz `docs/PLAN-MULTIPLATFORM-EXECUTION.md`).
- Lokacija: `apps/panel` (isti tokeni/komponente kao `apps/web`) + backend na **Convex**-u po odluci D3 (`docs/DECISION-KLARO-PLATFORM-STACK-20261006.md`): uređaji samo preko verzionisanog HTTP `/v1`, panel direktno preko Convex klijenta. Convex Cloud ili self-host je otvoreno pitanje K-1.

## Dizajn — Claude Design

- **Aktivacija (A1–A13):** nova stranica u projektu „Klaro Player redizajn“ (`2bc32c0c-…`), deli tokene, Klaro paletu i TV daljinski sa playerom.
- **Panel (B–D):** zaseban projekat „Klaro Panel“ na „Klaro Player Design System“ (`0163f186-…`).
