# Task Automation (Codex + Greptile)

Ovaj flow je napravljen da smanji ručni nadzor po tasku.

## Sta radi

- Svaki task ide u zaseban branch: `codex/lp-xxxx-auto`
- Svaki task radi u zasebnom git worktree-u: `.codex/worktrees/<TASK_ID>`
- Pokrece `codex exec` sa standardnim task promptom
- Proverava da je PR otvoren
- Automatski pinga Greptile i ceka review za trenutni HEAD commit
- Ako Greptile prijavi komentare:
  - pokrece novi `codex exec` pass da popravi validne komentare
  - false-positive treba da se oznaci komentarom na PR
  - pushuje fix na isti branch
- Ponavlja review/fix loop do `MAX_ROUNDS` (default: 3)
- Na kraju proverava overlap fajlova izmedju task branch-eva (docs fajlovi se po default-u ignorisu)
- Task PR-ovi su postavljeni da NE menjaju `BACKLOG.md` / `HANDOFF.md` (docs sync ide centralno posle merge queue)

## Komande

### Jedan task

```bash
pnpm tasks:run LP-0202
```

### Vise taskova paralelno

```bash
PARALLEL=3 pnpm tasks:batch LP-0202 LP-0203 LP-0204
```

Za 4 taska:

```bash
PARALLEL=4 pnpm tasks:batch LP-0202 LP-0203 LP-0204 LP-0205
```

### Auto merge queue (redosledan merge + docs sync)

```bash
pnpm tasks:merge LP-0202 LP-0203 LP-0204
```

Ovo radi:
- proverava da za svaki task postoji otvoren PR
- proverava Greptile na HEAD commitu (`no comments` ili `Confidence Score: 5/5`)
- proverava GitHub check-runove na PR-u (po default-u obavezni)
- merge-uje PR-ove redom kako su zadati taskovi
- na kraju radi centralni docs commit na `main`:
  - `BACKLOG.md` status taskova -> `done`
  - `HANDOFF.md` dobija batch merge session zapis

Ako treba samo docs sync (npr. neki PR je vec merge-ovan ranije):

```bash
pnpm tasks:docs-sync LP-0202 LP-0203 LP-0204
```

### Overlap provera branch-eva

```bash
pnpm tasks:overlap codex/lp-0202-auto codex/lp-0203-auto codex/lp-0204-auto
```

Da overlap bude hard fail:

```bash
FAIL_ON_OVERLAP=1 pnpm tasks:overlap codex/lp-0202-auto codex/lp-0203-auto
```

Ako hoces da overlap check ukljuci i docs fajlove:

```bash
IGNORE_OVERLAP_REGEX='^$' pnpm tasks:overlap codex/lp-0202-auto codex/lp-0203-auto
```

## Vazna podesavanja (env)

- `PARALLEL` default `3`
- `MAX_ROUNDS` Greptile ciklusa default `3`
- `POLL_SECONDS` default `20`
- `WAIT_TIMEOUT_SECONDS` default `1200`
- `FAIL_ON_OVERLAP` default `0`
- `IGNORE_OVERLAP_REGEX` default `^(BACKLOG\\.md|HANDOFF\\.md)$`
- `REQUIRE_GREPTILE` default `1` (merge queue)
- `REQUIRE_CHECKS` default `1` (merge queue)
- `REQUIRE_CHECKS_ALLOW_EMPTY` default `0` (merge queue; `1` dozvoljava merge i kada PR nema check-run signal)
- `MERGE_METHOD` default `merge` (merge queue; opcije: `merge`, `squash`, `rebase`)
- `SYNC_DOCS` default `1` (merge queue)
- `DRY_RUN` default `0` (merge queue; `1` samo provera bez merge/push)

## Napomene

- `tasks:merge` merge-uje PR automatski; koristi ga tek kad su task PR-ovi spremni.
- CI check-runovi su definisani u `.github/workflows/pr-quality-gate.yml`.
