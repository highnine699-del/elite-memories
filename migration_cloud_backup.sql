-- Run this once in Supabase Dashboard -> SQL Editor -> New Query.
-- Safe to run multiple times (IF NOT EXISTS guards).

ALTER TABLE photos ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS backup_path TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS backup_link TEXT;
ALTER TABLE photos ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- backed_up_at : set once the file has been uploaded to MEGA
-- backup_path  : remote MEGA path, e.g. "/Elite Memories/a1b2c3d4_IMG_0001.jpg"
-- backup_link  : real public MEGA link (from `mega-export -a`), used directly
--                by the admin dashboard once the file is archived
-- archived_at  : set once the object has been deleted from Supabase Storage
--                to free up quota. The row itself is never deleted, so it
--                still shows up in admin search/history either way.

CREATE INDEX IF NOT EXISTS idx_photos_backed_up_at ON photos(backed_up_at);
CREATE INDEX IF NOT EXISTS idx_photos_archived_at ON photos(archived_at);
