// Elite Memories -> MEGA sync
//
// What this does, every time it runs:
//   1. Finds any photos/videos in Supabase Storage that haven't been backed
//      up yet, downloads them, uploads each one to MEGA via the official
//      MEGAcmd CLI, and generates a real public link for it (`mega-export`).
//      Both the remote path and the link get saved back to the database row.
//   2. Checks total Supabase Storage usage (summed from what's already
//      recorded per-row — no need to query Storage directly). If it's
//      crossed the threshold, deletes the OLDEST already-backed-up files
//      from Supabase (never anything not yet safely uploaded to MEGA
//      first) until usage drops back under the target. The database row
//      always stays, so admin.html can still search/list it — once
//      archived, it just links out to MEGA instead of previewing from
//      Supabase.
//
// Requires MEGAcmd installed and on PATH: https://mega.io/cmd
// Run manually with `node sync.js`, or set up a scheduled task (see
// README.md) to run it automatically.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ws from 'ws';

const execAsync = promisify(exec);
const EXEC_OPTS = { maxBuffer: 20 * 1024 * 1024 }; // MEGAcmd's progress-bar output can be chatty

// Wrap an argument in double quotes for cmd.exe, escaping any embedded
// quotes. Needed because MEGAcmd's .bat wrappers don't reliably preserve
// Node's automatic array-argument quoting once spaces are involved (paths
// like "/Elite Memories" or "WhatsApp Image ... (1).jpeg" were getting
// split into multiple separate arguments without this).
function q(arg) {
  return `"${String(arg).replace(/"/g, '""')}"`;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MEGA_EMAIL = process.env.MEGA_EMAIL;
const MEGA_PASSWORD = process.env.MEGA_PASSWORD;
const MEGA_REMOTE_FOLDER = process.env.MEGA_REMOTE_FOLDER || '/Elite Memories';
const BUCKET = 'elite-memories';

// Supabase free tier = 500MB total storage. Start purging once usage
// crosses the threshold, purge down to the (lower) target so we're not
// purging on every single run once you're near the ceiling.
const PURGE_THRESHOLD_BYTES = 400 * 1024 * 1024; // start purging at 400MB
const PURGE_TARGET_BYTES = 300 * 1024 * 1024;    // purge down to 300MB

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env — see .env.example');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  realtime: { transport: ws },
});

async function main() {
  console.log(`[${new Date().toISOString()}] Starting sync run`);
  await ensureMegaLogin();
  await backupNewFiles();
  await purgeIfNeeded();
  console.log(`[${new Date().toISOString()}] Sync run complete\n`);
}

async function ensureMegaLogin() {
  try {
    const { stdout } = await execAsync(`mega-whoami`, EXEC_OPTS);
    console.log(`MEGA session: ${stdout.trim()}`);
  } catch {
    if (!MEGA_EMAIL || !MEGA_PASSWORD) {
      throw new Error('Not logged into MEGA, and MEGA_EMAIL/MEGA_PASSWORD not set in .env to log in automatically.');
    }
    console.log('No active MEGA session, logging in...');
    await execAsync(`mega-login ${q(MEGA_EMAIL)} ${q(MEGA_PASSWORD)}`, EXEC_OPTS);
  }

  // Make sure the remote folder exists — mega-mkdir errors if it already
  // exists, which is fine, we just ignore that.
  try {
    await execAsync(`mega-mkdir -p ${q(MEGA_REMOTE_FOLDER)}`, EXEC_OPTS);
  } catch {
    // already exists, ignore
  }
}

async function backupNewFiles() {
  const { data: rows, error } = await supabase
    .from('photos')
    .select('id, storage_path, original_filename, created_at')
    .is('backed_up_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to query unbacked-up photos:', error.message, error.cause || '');
    return;
  }

  if (!rows || rows.length === 0) {
    console.log('Nothing new to back up.');
    return;
  }

  console.log(`Backing up ${rows.length} file(s) to MEGA...`);

  for (const row of rows) {
    let tmpPath = null;
    try {
      const { data: blob, error: downloadError } = await supabase
        .storage
        .from(BUCKET)
        .download(row.storage_path);

      if (downloadError || !blob) {
        console.error(`  FAILED download ${row.original_filename}:`, downloadError?.message);
        continue;
      }

      const filename = safeFilename(row.original_filename, row.id);
      tmpPath = path.join(os.tmpdir(), filename);
      const buffer = Buffer.from(await blob.arrayBuffer());
      fs.writeFileSync(tmpPath, buffer);

      await execAsync(`mega-put ${q(tmpPath)} ${q(MEGA_REMOTE_FOLDER)}`, EXEC_OPTS);

      const remotePath = `${MEGA_REMOTE_FOLDER}/${filename}`;
      const link = await getMegaLink(remotePath);

      const { error: updateError } = await supabase
        .from('photos')
        .update({
          backed_up_at: new Date().toISOString(),
          backup_path: remotePath,
          backup_link: link,
        })
        .eq('id', row.id);

      if (updateError) {
        console.error(`  Uploaded but FAILED to mark backed up: ${row.original_filename}:`, updateError.message);
        continue;
      }

      console.log(`  OK: ${row.original_filename} -> ${remotePath}${link ? ' (' + link + ')' : ' (no link generated)'}`);
    } catch (err) {
      console.error(`  ERROR on ${row.original_filename}:`, err.message);
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    }
  }
}

async function getMegaLink(remotePath) {
  try {
    const { stdout } = await execAsync(`mega-export -a ${q(remotePath)}`, EXEC_OPTS);
    const match = stdout.match(/https:\/\/mega\.nz\/\S+/);
    if (!match) {
      console.warn(`  mega-export ran but no link found in output for ${remotePath}. Raw output:`, stdout.trim());
      return null;
    }
    return match[0];
  } catch (err) {
    console.warn(`  Failed to generate MEGA link for ${remotePath}:`, err.message);
    return null; // upload still succeeded — link is best-effort, not a failure
  }
}

async function purgeIfNeeded() {
  const totalBytes = await getSupabaseUsageBytes();
  console.log(`Current Supabase Storage usage: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

  if (totalBytes < PURGE_THRESHOLD_BYTES) {
    console.log('Under threshold, no purge needed.');
    return;
  }

  console.log(`Over ${(PURGE_THRESHOLD_BYTES / 1024 / 1024).toFixed(0)}MB threshold, purging oldest backed-up files...`);

  const { data: candidates, error } = await supabase
    .from('photos')
    .select('id, storage_path, original_filename, size, created_at')
    .not('backed_up_at', 'is', null)
    .is('archived_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to query purge candidates:', error.message);
    return;
  }

  if (!candidates || candidates.length === 0) {
    console.warn('Over threshold but nothing is eligible to purge yet (nothing backed up). ' +
      'Backup step may be failing — check the log above.');
    return;
  }

  let remaining = totalBytes;

  for (const row of candidates) {
    if (remaining <= PURGE_TARGET_BYTES) break;

    const { error: removeError } = await supabase
      .storage
      .from(BUCKET)
      .remove([row.storage_path]);

    if (removeError) {
      console.error(`  FAILED to remove ${row.original_filename} from storage:`, removeError.message);
      continue;
    }

    const { error: updateError } = await supabase
      .from('photos')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updateError) {
      console.error(`  Removed from storage but FAILED to mark archived: ${row.original_filename}:`, updateError.message);
      continue;
    }

    remaining -= row.size || 0;
    console.log(`  Archived: ${row.original_filename} (freed ${((row.size || 0) / 1024 / 1024).toFixed(1)}MB, now at ${(remaining / 1024 / 1024).toFixed(1)}MB)`);
  }
}

async function getSupabaseUsageBytes() {
  const { data, error } = await supabase
    .from('photos')
    .select('size')
    .is('archived_at', null);

  if (error) {
    console.error('Failed to compute storage usage from DB:', error.message, error.cause || '');
    return 0;
  }

  return (data || []).reduce((sum, row) => sum + (row.size || 0), 0);
}

function safeFilename(originalFilename, id) {
  const base = originalFilename.replace(/[\\/:*?"<>|]/g, '_'); // strip Windows-illegal chars
  return `${String(id).slice(0, 8)}_${base}`;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
