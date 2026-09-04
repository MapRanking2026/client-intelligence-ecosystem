# Monorepo Restructure Runbook (run locally by a human)

Turns the current single-app repo (git root = `apps/web`, deployed by Vercel) into the target
monorepo (git root = `E:\motsv7`, app at `apps/mtos`). This step must be run by you because (a) the
agent sandbox keeps `apps/web` open, so Windows blocks the rename, and (b) it requires a Vercel
Root Directory change, which is a production action.

Rollback anchor at time of writing: **`f432a4f`** on `origin/main`.
Full local backup exists at `E:\motsv7\backups\web-backup-*.tar.gz`.
The future root files are already staged (untracked) at `E:\motsv7\package.json` and `E:\motsv7\.gitignore`.

## 0. Preconditions (critical)
1. Commit or stash any in-progress work in `apps/web` so the tree is clean:
   `git -C E:\motsv7\apps\web status`
2. **Close everything holding `apps\web`**: your editor/IDE window opened at `apps\web`, any running
   `next dev`/`npm` process, and any terminal whose current directory is inside `apps\web`.
   The rename fails with "Device or resource busy" if anything still holds it.

## 1. Re-root git and rename the app (PowerShell, from E:\motsv7)
```powershell
cd E:\motsv7
git -C apps\web rev-parse HEAD          # confirm it prints f432a4f...
Move-Item -Path apps\web\.git -Destination .git      # lift the repo to the monorepo root
Move-Item -Path apps\web -Destination apps\mtos       # rename the app folder
```
node_modules and .next live inside the folder and move with it (instant same-volume rename).

## 2. Verify MTOS still builds from its new home
```powershell
cd E:\motsv7\apps\mtos
npm run build            # must succeed, same ~42 routes
```
The app's own `node_modules` moved with it, so no reinstall is needed for this check.

## 3. Adopt the root npm workspace (optional but recommended for "build from root")
```powershell
cd E:\motsv7
Remove-Item apps\mtos\package-lock.json   # the root lockfile supersedes it (avoid two lockfiles)
npm install                                # creates root package-lock.json + hoisted node_modules
npm run build                              # root script -> builds apps/mtos
```
If `npm install` changes resolved versions and anything breaks, restore `apps\mtos\package-lock.json`
from git and keep building per-app (`cd apps\mtos && npm run build`) until the hoist is validated.

## 4. Record the move in git (review first — the repo root now contains loose files)
Because the repo root is now `E:\motsv7`, previously-untracked root files (e.g. `analysis\`,
`master-prompt-by-sections\`, `*.md`, `*.docx`) are now inside the worktree. `.gitignore` already
excludes `backups\`, `node_modules`, `.next`, `.trae\`, and `.env*`. **Review before adding:**
```powershell
cd E:\motsv7
git status                                 # confirm apps/mtos shows as renamed, review loose files
git add -A
git status                                 # verify renames (R) preserve history; unwanted files? add to .gitignore
git commit -m "chore: restructure to monorepo (apps/mtos + root workspace)"
```
`git log --follow apps/mtos/<file>` will still show full history across the rename.

## 5. Vercel (production) — required before the next deploy succeeds
In the Vercel project connected to `MapRanking2026/mtosv0`:
1. **Settings → General → Root Directory: change from the repo root to `apps/mtos`.**
2. Confirm the Build & Output settings still target Next.js.
3. Confirm crons still resolve — `vercel.json` moved to `apps/mtos/vercel.json`; with Root Directory
   = `apps/mtos`, the two crons (`/api/cron/daily-sync` 09:00 UTC, `/api/cron/refresh-tokens` 03:00 UTC)
   are picked up. Verify in Settings → Cron Jobs after the first deploy.
4. Environment variables are unchanged in value; verify none referenced the old path.
5. OAuth redirect URIs are route-based (unchanged) — no change expected, but reconfirm ClickUp/Google/GHL
   callbacks still point at the same public URLs.

## 6. After it's green
Tell the agent "restructure done" and it will continue: create `packages/contracts`, `packages/core`,
scaffold `apps/seoos`, and build the first request/package vertical slice + the Lead & Call sorting.

## Rollback
- Before step 4 commit: `Move-Item apps\mtos\.git .git-tmp` is not needed — simply reverse:
  `Move-Item apps\mtos apps\web` then `Move-Item .git apps\web\.git` (with `E:\motsv7\.git` back inside).
- After committing: `git revert` the restructure commit, or `git reset --hard f432a4f` **only** if no
  other work was committed after it, or restore from `backups\web-backup-*.tar.gz`.
- Revert the Vercel Root Directory back to the repo root.
