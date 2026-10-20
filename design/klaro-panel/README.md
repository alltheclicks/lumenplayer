# Klaro Panel — dizajn

Projekat za `panel.klaroplayer.com` na „Klaro Player Design System“. Specifikacija: `docs/KLARO-NALOZI-I-PANEL.md` (repo alltheclicks/lumenplayer).
Komunikacija u ovom projektu: srpski (latinica).

## Kako se gleda
Otvori **Klaro Panel.dc.html**. Gornja traka: uloga (Korisnik / Provajder / Genadmin), za korisnika plan (Gost / Free / Premium / Premium · 5 TV / Od provajdera), uređaj, tema. Drugi red su ekrani uloge.

| Fajl | Sadržaj |
|---|---|
| Klaro Panel.dc.html | ljuska: bočni meni, gornja traka, mobilna navigacija, toast, „Prijavi se kao“, izbor plana |
| PanelPrijava.dc.html | K0 · Google/Apple/Microsoft/GitHub + magic link (čekanje, drugi uređaj, istekao), dobrodošlica + promo pristanak, izbor naloga, zahtev za partnera |
| PanelPoveziTV.dc.html | K2 · kod/QR → potvrda → nalepi listu (M3U / Xtream poruka, auto-prepoznavanje) → poslato · Gost režim · limit 5/5 |
| PanelPlan.dc.html | K4 · Free / Premium €10, proba 30 dana, plaćanje |
| PanelKorisnik.dc.html | K1 Moji uređaji (po planu, promena vlasnika, ponuda partnera) · K3 Izvori · K5 Nalog |
| PanelProvajder.dc.html | P1–P9 · P4 upozorenje za TV posle reseta (TQ5-9HN) · grupno >10 kredita = potvrda emailom |
| PanelGenadmin.dc.html | G1–G7 · G5 Free/Premium + signal · G4 istorija uređaja |
| Klaro nalozi.dc.html, Prijava predlozi.dc.html | istraživanje / predlozi (arhiva) |

## Pravila naloga
- Bez naloga osnovno gledanje uvek radi; na TV-u se nikad ne kuca nalog ni lozinka.
- Free: 5 povezanih, gleda 1 u isto vreme. Premium €10/god: 5 istovremeno + sync, backup. Proba 30 dana jednom po nalogu i uređaju.
- Uređaj: stalni ID u backendu (preživljava reset) + kod na TV-u 15 min, jednokratan.
- Provajder: isti login, mora nalog, čeka odobrenje; >10 kredita odjednom = potvrda emailom.

## Veza sa aktivacijom (projekat „Klaro Player redizajn“ → Aktivacija.dc.html)
- TV A2 „Poveži ovaj TV“ → QR vodi na **K2 Poveži TV** (kod već upisan) → potvrda → TV prelazi na A3/A4.
- Ili korisnik pošalje kod provajderu → **P4 Aktiviraj uređaj** (troši kredit) → TV A4 „Povezano“.
- Vaučer (A5) = kod iz **P6 Aktivacioni kodovi**. Brending iz **P8** se vidi na A7 / A13.
- Blokada iz **G7** → A8 / A9 na uređaju. Minimalna verzija iz **G6** → „Potrebno ažuriranje“.

## Demo podaci
Provajder „Orbita TV“ (184 kredita, cena €4,20/kr, doživotna = 3 kr.), korisnica Ana Petrović, TV kodovi KLR-7Q4 / M8X2PD / TQ59HN / W3K8RZ, vaučeri KLRO-2026-TV01…

## Predlozi koje treba potvrditi
1. Vaučeri: krediti se **rezervišu pri generisanju**, poništen neiskorišćen kod vraća kredit.
2. Pogrešna aktivacija: povrat kredita u roku od 24 h.
3. Direktni: €14,99 godišnje / €39,99 doživotno po uređaju (primer), bez automatskog obnavljanja; zamena uređaja 3× godišnje.
4. Uloga „Podrška“ kod provajdera troši kredite samo ako vlasnik uključi prekidač.
5. „Prijavi se kao“: obavezan razlog, najviše 30 min, upis u dnevnik.
