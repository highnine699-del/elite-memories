# Elite Memories -> MEGA Sync

Backs up uploads from Supabase Storage to MEGA, using MEGA's own official
command-line tool (MEGAcmd) — no reverse-engineered APIs, no scraped
cookies. Once Supabase Storage usage crosses 400MB, it deletes the *oldest
already-backed-up* files from Supabase to free up your 500MB free tier —
never anything that hasn't been safely uploaded to MEGA first.

Files aren't lost when removed from Supabase: the database row stays
forever, so they still show up in the admin dashboard's list/search.
Preview and download from admin work normally for files still in Supabase;
archived files show a "Backed up" badge with a real "Open in MEGA" link
that opens that exact file.

## One-time setup

1. **Install MEGAcmd**: https://mega.io/cmd — pick your OS, run the installer.
2. **Confirm it's on PATH.** Open a new PowerShell window and run:
   ```powershell
   mega-whoami
   ```
   It should print "Not logged in" (not "command not found"). If PATH isn't picked up, reboot once — the installer usually needs that on Windows.
3. **Create a dedicated MEGA account** for this project (not your personal one, if you have one) at mega.nz — keeps the 20GB clean and separate.
4. Node.js 18+, then in this folder:
   ```powershell
   npm install
   copy .env.example .env
   ```
5. Fill in `.env`:
   - `SUPABASE_SERVICE_ROLE_KEY` — Dashboard -> Settings -> API -> `service_role`
   - `MEGA_EMAIL` / `MEGA_PASSWORD` — the dedicated account from step 3
6. Run the DB migration once: open `migration_cloud_backup.sql` (one folder up), paste into Supabase Dashboard -> SQL Editor -> New Query -> Run.

## Run it manually

```powershell
npm run sync
```

First run logs into MEGA and saves the session — later runs reuse it, so
`MEGA_EMAIL`/`MEGA_PASSWORD` in `.env` mostly matter for the very first run
(and if you ever `mega-logout`).

Safe to run as many times as you want — it only uploads files it hasn't
already backed up, and only purges when actually over the Supabase threshold.

## Run it automatically (Windows Task Scheduler)

1. Task Scheduler -> Create Task (full dialog, not "Basic Task").
2. **General**: name it `Elite Memories MEGA Sync`.
3. **Triggers** -> New -> Daily, repeat every **1 hour**, indefinitely.
4. **Actions** -> New -> Program/script: `node`, Arguments: `sync.js`, Start in: full path to this folder.
5. Save, then right-click -> Run once to confirm it works before trusting the schedule.

## First real test

Before trusting this fully, run it once and check:
1. Console shows "OK: <filename> -> /Elite Memories/..." with a real `https://mega.nz/...` link.
2. Open that link in a browser you're not logged into MEGA on — confirm it actually opens the file.
3. Check the `photos` row in Supabase (Table Editor) — `backed_up_at`, `backup_path`, `backup_link` should all be filled in.

If `mega-export` runs but no link shows up in the console output, paste me
the raw output line — MEGAcmd's exact output format can vary slightly by
version and I'll adjust the parsing regex in `sync.js` to match.

## Adjusting the thresholds

Near the top of `sync.js`:

```js
const PURGE_THRESHOLD_BYTES = 400 * 1024 * 1024; // start purging at 400MB
const PURGE_TARGET_BYTES = 300 * 1024 * 1024;    // purge down to 300MB
```

Supabase's free tier is 500MB total. Running the sync more frequently
(e.g. every 15 minutes during a live gathering) lets you push the threshold
closer to 450MB safely.

## Troubleshooting

- **"mega-whoami: command not found"** — MEGAcmd isn't on PATH. Reboot after installing, or reinstall and check the "add to PATH" option if the installer has one.
- **"Not logged into MEGA..." error even with MEGA_EMAIL/PASSWORD set** — check for typos, and that 2FA isn't enabled on the MEGA account (MEGAcmd's non-interactive login doesn't handle 2FA prompts well; simplest fix is to not enable 2FA on the dedicated backup account).
- **Files upload but `backup_link` stays null in the DB** — `mega-export` failed silently or its output format didn't match. Not a data-loss issue (the file's safely in MEGA either way), but paste me the console output and I'll fix the parsing.
- **Purge runs but Supabase usage doesn't drop** — check console for "FAILED to remove" lines.
