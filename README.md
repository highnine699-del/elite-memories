# Elite Memories (Supabase Edition)

A private photo/video upload tool for a friend group. Friends can upload original-quality photos and videos (no compression, no resizing) directly to Supabase Storage. An admin can view, search, download, and delete uploads through a separate dashboard.

## Features

- **Direct-to-Supabase Uploads**: Files upload directly to Supabase Storage using the anon key
- **Resumable Uploads**: Large files automatically use chunked/resumable upload via Supabase SDK
- **Automatic Retry**: Failed uploads retry automatically with exponential backoff
- **Visibility Handling**: iOS Safari background tab handling - uploads resume when tab becomes visible
- **Admin Dashboard**: Search, preview, download, and delete uploads
- **Row Level Security**: Anon key can only INSERT, never SELECT/UPDATE/DELETE
- **Rate Limiting**: Protection against abuse on upload and admin login endpoints

## Tech Stack

- **Frontend**: Plain HTML5, CSS3, vanilla JavaScript (no frameworks, no build step)
- **Backend**: Supabase Edge Functions (Deno/TypeScript)
- **Storage**: Supabase Storage (private bucket)
- **Database**: Supabase Postgres with Row Level Security (RLS)
- **Frontend Hosting**: Cloudflare Pages (free tier)
- **Supabase Hosting**: Supabase free tier (no card required)

## Prerequisites

- Supabase account (free tier, no credit card required)
- Cloudflare account (for Pages hosting, free tier)
- Node.js and npm (for Supabase CLI)

## Setup Instructions

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up for a free account
2. Click "New Project"
3. Choose a name (e.g., "elite-memories")
4. Set a database password (save this securely)
5. Choose a region closest to your users
6. Wait for the project to be provisioned (1-2 minutes)

### 2. Run the Database Schema

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click "New Query"
3. Copy the contents of `schema-supabase.sql`
4. Paste it into the SQL editor
5. Click "Run" to execute the schema

This creates:
- `photos` table (with RLS enabled)
- `rate_limits` table (with RLS enabled)
- `admin_sessions` table (with RLS enabled)
- RLS policy allowing anon INSERT only on photos table

### 3. Create Storage Bucket and Set Policies

1. In your Supabase dashboard, go to **Storage** (left sidebar)
2. Click "Create a new bucket"
3. Name it `elite-memories`
4. Make it **Private** (not public)
5. Click "Create bucket"

**Set Storage Policies:**

1. Go to **Storage** → **elite-memories** bucket → **Policies**
2. Click "New Policy" → "For full customization"
3. Create an INSERT policy for anon role:
   - Name: `anon can upload`
   - Allowed operations: `INSERT`
   - Target role: `anon`
   - USING expression: `true`
   - Check expression: `true`
4. **Do NOT** create any SELECT, UPDATE, or DELETE policies for anon role
5. The service role (used in Edge Functions) bypasses RLS entirely

**Set File Size Limits:**

1. Go to **Storage** → **elite-memories** bucket → **Configuration**
2. Set "File size limit" to `524288000` (500MB in bytes)
3. This enforces the video size limit server-side

### 4. Get Supabase Credentials

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy these values:
   - **Project URL** (e.g., `https://xxxxxxxx.supabase.co`)
   - **anon public key** (starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`)
   - **service_role key** (starts with `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`) - **keep this secret!**

### 5. Update Frontend Configuration

Edit `public/app-supabase.js` and `public/admin-supabase.js`:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';  // From step 4
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';  // From step 4
const SUPABASE_EDGE_FUNCTION_URL = 'YOUR_SUPABASE_EDGE_FUNCTION_URL_HERE';  // Will be set after deploying Edge Functions
```

### 6. Install Supabase CLI

```bash
npm install -g supabase
```

Or using homebrew:
```bash
brew install supabase/tap/supabase
```

### 7. Link to Your Supabase Project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_ID
```

Your project ID is the part before `.supabase.co` in your project URL.

### 8. Set Admin Password Secret

```bash
supabase secrets set ADMIN_PASSWORD=your_secure_password_here
```

This sets the admin password as a Supabase secret, never in source code.

### 9. Deploy Edge Functions

Deploy each Edge Function:

```bash
supabase functions deploy admin-login
supabase functions deploy admin-list
supabase functions deploy admin-download
supabase functions deploy admin-delete
```

After deployment, Supabase will show you the Edge Function URL (e.g., `https://xxxxxxxx.supabase.co/functions/v1/`).

Update `public/admin-supabase.js` with this URL:
```javascript
const SUPABASE_EDGE_FUNCTION_URL = 'https://xxxxxxxx.supabase.co/functions/v1';
```

### 10. Deploy Frontend to Cloudflare Pages

**Option A: Using Git (Recommended)**

1. Push your code to GitHub/GitLab/Bitbucket
2. Go to [Cloudflare Pages](https://pages.cloudflare.com)
3. Click "Create a project"
4. Connect to your Git repository
5. Build settings:
   - Build command: (leave empty)
   - Build output directory: `public`
6. Click "Save and Deploy"

**Option B: Direct Upload**

1. Go to [Cloudflare Pages](https://pages.cloudflare.com)
2. Click "Create a project" → "Upload assets"
3. Drag and drop the `public` folder
4. Click "Deploy Site"

### 11. Test Edge Functions Locally (Optional)

To test Edge Functions locally before deploying:

```bash
supabase functions serve
```

This runs Edge Functions at `http://localhost:54321/functions/v1/`.

## Usage

### Uploading Files

1. Open your Cloudflare Pages URL (e.g., `https://your-site.pages.dev`)
2. Drag and drop photos/videos or click "Choose Files"
3. Optionally add your name and a caption
4. Files upload directly to Supabase Storage with progress tracking
5. Large files (>6MB) use resumable upload automatically

### Admin Dashboard

1. Navigate to `/admin.html` on your Pages domain
2. Enter the admin password you set via `supabase secrets set`
3. View, search, preview, download, or delete uploads

## Security Checklist

- [x] `photos` table has RLS enabled with only an anon INSERT policy
- [x] Storage bucket is private, anon can only INSERT
- [x] `ADMIN_PASSWORD` is a Supabase secret, never hardcoded
- [x] Every Edge Function validates session token before operations
- [x] Service role key used only inside Edge Functions
- [x] Anon key (safe to expose) is the only key in frontend code
- [x] Rate limiting active on uploads and admin login
- [x] File size limits set at Storage bucket level

## File Structure

```
elite-memories/
  schema-supabase.sql           # Database schema
  supabase/
    functions/
      admin-login/index.ts      # Admin login Edge Function
      admin-list/index.ts       # Admin list/search Edge Function
      admin-download/index.ts   # Admin download Edge Function
      admin-delete/index.ts     # Admin delete Edge Function
  public/
    index.html                  # Upload page
    admin.html                  # Admin dashboard
    style.css                   # Dark glassmorphism styling
    app-supabase.js             # Supabase upload logic
    admin-supabase.js           # Admin panel logic
  README-SUPABASE.md            # This file
```

## Manual Backup from Supabase Storage

To download all files from Supabase Storage for backup:

### Using Supabase Dashboard

1. Go to **Storage** → **elite-memories** bucket
2. Browse to the file you want to download
3. Click the file and select "Download"

### Using Supabase CLI

```bash
# Download a specific file
supabase storage cp --project-ref YOUR_PROJECT_ID elite-memories/uploads/file.jpg ./local-backup/

# Download entire bucket (requires scripting)
```

### Using rclone (Recommended for Bulk Export)

1. Install rclone
2. Configure rclone for S3-compatible storage:

```bash
rclone config
```

Follow prompts:
- Name: `supabase-elite-memories`
- Type: `S3`
- Provider: `Other`
- Access Key ID: Your Supabase access key (from Storage settings)
- Secret Access Key: Your Supabase secret key (from Storage settings)
- Region: `auto` or your bucket region
- Endpoint: `https://xxxxxxxx.supabase.co/storage/v1/s3`

3. Download entire bucket:

```bash
rclone sync supabase-elite-memories:elite-memories ./local-backup
```

## Changing Admin Password

To change the admin password later:

```bash
supabase secrets set ADMIN_PASSWORD=new_secure_password
```

Then redeploy the Edge Functions:

```bash
supabase functions deploy admin-login
```

## Troubleshooting

### Uploads fail with "Rate limit exceeded"

- Check the `rate_limits` table in Supabase
- The limit is 50 uploads per hour per IP
- Wait for the window to expire (1 hour) or contact admin

### Admin login fails

- Verify `ADMIN_PASSWORD` secret is set: `supabase secrets list`
- Check Edge Function logs in Supabase dashboard
- Ensure Edge Functions are deployed

### Storage upload fails

- Check Storage bucket policies allow INSERT for anon role
- Verify file size doesn't exceed 500MB limit
- Check browser console for specific error messages

### Edge Functions return 401

- Verify session token is valid
- Check `admin_sessions` table for expired tokens
- Session tokens expire after 24 hours

### HEIC files show as generic icon

- This is expected behavior - browsers can't render HEIC natively
- Files are stored correctly and can be downloaded

## Browser Compatibility

Tested on:
- iPhone Safari (iOS 14+)
- Android Chrome
- Desktop Chrome
- Edge
- Firefox

## Cost

- **Supabase Free Tier**: 500MB storage, 1GB bandwidth/month, 500k Edge Function invocations/month
- **Cloudflare Pages**: Free tier with unlimited bandwidth
- This should be sufficient for a friend group with moderate usage

## License

Private project for friend group use.
