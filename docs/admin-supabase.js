// Elite Memories - Admin Panel (Supabase Edition)
// Handles authentication, upload listing, search, preview, download, and delete

// REPLACE THESE WITH YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://cerlfqylakobkxnmweij.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_n2nb2F5ZdDVWC2LxXN8pPQ_qv0NJGV1';
const SUPABASE_EDGE_FUNCTION_URL = 'https://cerlfqylakobkxnmweij.supabase.co/functions/v1';

// State (in-memory only, no localStorage/sessionStorage)
let sessionToken = null;
let currentPage = 1;
let searchQuery = '';
let searchTimeout = null;

// --- HEIC preview decoding (client-side, lazy-loaded, concurrency-limited) ---
// heic-to wraps libheif compiled to WebAssembly. We only pull it in the
// moment a HEIC/HEIF file actually shows up in a page of results, and we
// cap how many decodes run at once so a page full of iPhone photos doesn't
// spin up a dozen WASM decodes simultaneously and lock the tab.
const HEIC_TO_CDN_URL = 'https://cdn.jsdelivr.net/npm/heic-to@1.5.2/dist/iife/heic-to.js';
const HEIC_DECODE_TIMEOUT_MS = 12000;
const MAX_CONCURRENT_HEIC_DECODES = 2;

let heicToLoadPromise = null;
function loadHeicToLib() {
  if (heicToLoadPromise) return heicToLoadPromise;
  heicToLoadPromise = new Promise((resolve, reject) => {
    if (window.HeicTo) return resolve(window.HeicTo);
    const script = document.createElement('script');
    script.src = HEIC_TO_CDN_URL;
    script.onload = () => resolve(window.HeicTo);
    script.onerror = () => reject(new Error('Failed to load heic-to library'));
    document.head.appendChild(script);
  });
  return heicToLoadPromise;
}

let activeHeicDecodes = 0;
const heicDecodeQueue = [];
function runWithHeicLimit(decodeFn) {
  return new Promise((resolve, reject) => {
    const task = () => {
      activeHeicDecodes++;
      decodeFn().then(resolve, reject).finally(() => {
        activeHeicDecodes--;
        const next = heicDecodeQueue.shift();
        if (next) next();
      });
    };
    if (activeHeicDecodes < MAX_CONCURRENT_HEIC_DECODES) {
      task();
    } else {
      heicDecodeQueue.push(task);
    }
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

// DOM Elements
const loginSection = document.getElementById('login-section');
const dashboardSection = document.getElementById('dashboard-section');
const adminPasswordInput = document.getElementById('admin-password');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const searchInput = document.getElementById('search-input');
const uploadsGrid = document.getElementById('uploads-grid');
const pagination = document.getElementById('pagination');
const prevButton = document.getElementById('prev-button');
const nextButton = document.getElementById('next-button');
const paginationInfo = document.getElementById('pagination-info');
const noResults = document.getElementById('no-results');

// Initialize
function init() {
  setupEventListeners();
}

function setupEventListeners() {
  loginButton.addEventListener('click', handleLogin);
  adminPasswordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  searchInput.addEventListener('input', handleSearchInput);

  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      fetchUploads();
    }
  });

  nextButton.addEventListener('click', () => {
    currentPage++;
    fetchUploads();
  });
}

async function handleLogin() {
  const password = adminPasswordInput.value;

  if (!password) {
    showLoginError('Please enter a password');
    return;
  }

  try {
    const response = await fetch(`${SUPABASE_EDGE_FUNCTION_URL}/admin-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ password })
    });

    if (response.ok) {
      const data = await response.json();
      sessionToken = data.token;
      showDashboard();
    } else {
      const error = await response.json();
      showLoginError(error.error || 'Login failed');
    }
  } catch (error) {
    console.error('Login error:', error);
    showLoginError('Network error. Please try again.');
  }
}

function showLoginError(message) {
  loginError.textContent = message;
  loginError.classList.remove('hidden');
  setTimeout(() => {
    loginError.classList.add('hidden');
  }, 3000);
}

function showDashboard() {
  loginSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  fetchUploads();
}

function handleSearchInput(e) {
  searchQuery = e.target.value.trim();

  // Debounce search
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    currentPage = 1;
    fetchUploads();
  }, 300);
}

async function fetchUploads() {
  if (!sessionToken) {
    // Redirect to login if no session
    dashboardSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    return;
  }

  try {
    const url = new URL(`${SUPABASE_EDGE_FUNCTION_URL}/admin-list`);
    if (searchQuery) {
      url.searchParams.set('search', searchQuery);
    }
    url.searchParams.set('page', currentPage);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'apikey': SUPABASE_ANON_KEY,
      }
    });

    if (response.status === 401) {
      // Session expired, redirect to login
      sessionToken = null;
      dashboardSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
      showLoginError('Session expired. Please login again.');
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch uploads: ${response.statusText}`);
    }

    const data = await response.json();
    renderUploads(data.photos, data.hasMore);

  } catch (error) {
    console.error('Fetch uploads error:', error);
    uploadsGrid.innerHTML = '<p class="error-text">Failed to load uploads. Please try again.</p>';
  }
}

async function renderUploads(uploads, hasMore) {
  uploadsGrid.innerHTML = '';

  if (uploads.length === 0) {
    noResults.classList.remove('hidden');
    pagination.classList.add('hidden');
    return;
  }

  noResults.classList.add('hidden');

  // Fetch every card's signed-URL preview in parallel, then append in
  // original order once all are ready.
  const cards = await Promise.all(uploads.map(upload => createUploadCard(upload)));
  for (const card of cards) {
    uploadsGrid.appendChild(card);
  }

  // Update pagination
  updatePagination(hasMore);
}

async function createUploadCard(upload) {
  const card = document.createElement('div');
  card.className = 'upload-card-item';

  // createPreview is async (it fetches a signed URL) — must be awaited
  // or appendChild receives a Promise instead of a Node.
  const preview = await createPreview(upload);
  const info = createInfo(upload);
  const actions = createActions(upload);

  card.appendChild(preview);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}

async function createPreview(upload) {
  const preview = document.createElement('div');
  preview.className = 'upload-preview';

  // Archived files were deleted from Supabase Storage to free up quota —
  // don't attempt a signed URL, it will just 404. Show where it lives now.
  if (upload.archived_at) {
    preview.innerHTML = `
      <div class="preview-placeholder archived">
        <div class="archived-icon">☁️</div>
        <div class="archived-label">Backed up to TeraBox</div>
      </div>
    `;
    return preview;
  }

  const ext = getExtension(upload.original_filename);
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isVideo = ['mp4', 'mov'].includes(ext);
  const isHeic = ['heic', 'heif'].includes(ext);

  if (isHeic) {
    // Real thumbnail via client-side WASM decode, not just a placeholder icon.
    preview.innerHTML = `
      <div class="preview-placeholder preview-loading">
        <div class="preview-spinner"></div>
      </div>
    `;
    try {
      const signedUrl = await getSignedUrl(upload.id);
      const [blob, HeicTo] = await Promise.all([
        fetch(signedUrl).then(r => {
          if (!r.ok) throw new Error(`fetch failed: ${r.status}`);
          return r.blob();
        }),
        loadHeicToLib(),
      ]);
      const jpegBlob = await withTimeout(
        runWithHeicLimit(() => HeicTo({ blob, type: 'image/jpeg', quality: 0.5 })),
        HEIC_DECODE_TIMEOUT_MS
      );
      const objectUrl = URL.createObjectURL(jpegBlob);
      const img = document.createElement('img');
      img.src = objectUrl;
      img.alt = escapeHtml(upload.original_filename);
      img.loading = 'lazy';
      img.onerror = () => {
        preview.innerHTML = '<div class="preview-placeholder"><div class="generic-icon">🖼️</div></div>';
      };
      preview.innerHTML = '';
      preview.appendChild(img);
    } catch (err) {
      // Decode failed or timed out (corrupt file, unsupported HEIC variant,
      // library failed to load) — fall back to the generic icon rather than
      // leaving the spinner stuck forever.
      preview.innerHTML = '<div class="preview-placeholder"><div class="generic-icon">🖼️</div></div>';
    }
  } else if (isImage) {
    // Get signed URL for image preview
    try {
      const signedUrl = await getSignedUrl(upload.id);
      const img = document.createElement('img');
      img.src = signedUrl;
      img.alt = escapeHtml(upload.original_filename);
      img.loading = 'lazy';
      img.onerror = () => {
        // Browser couldn't decode this despite the .jpg/.png extension —
        // most commonly a HEIC photo that got mislabeled with a JPEG
        // extension somewhere along the way (phone/share-sheet quirk).
        // Fall back to the same placeholder used for known-HEIC files
        // instead of leaving a blank box with no explanation.
        preview.innerHTML = '<div class="preview-placeholder"><div class="generic-icon">🖼️</div></div>';
      };
      preview.appendChild(img);
    } catch {
      // Fallback to placeholder if signed URL fails
      preview.innerHTML = '<div class="preview-placeholder">📷</div>';
    }
  } else if (isVideo) {
    // Get signed URL for video preview
    try {
      const signedUrl = await getSignedUrl(upload.id);
      const video = document.createElement('video');
      video.src = signedUrl;
      video.controls = true;
      video.preload = 'metadata';
      video.onerror = () => {
        // Almost always an iPhone .mov encoded in HEVC (H.265), which Chrome
        // and most non-Safari browsers can't decode in a <video> tag — not a
        // broken file. Converting these needs server-side transcoding
        // (ffmpeg), a bigger lift than the HEIC case since it can't be done
        // cheaply client-side; tracked as a follow-up, not fixed here.
        preview.innerHTML = `
          <div class="preview-placeholder">
            <div class="generic-icon">🎬</div>
            <div class="archived-label">Codec not supported in this browser — download to view</div>
          </div>
        `;
      };
      preview.appendChild(video);
    } catch {
      preview.innerHTML = '<div class="preview-placeholder">🎬</div>';
    }
  } else {
    // Other/unknown file type - show generic icon
    preview.innerHTML = `
      <svg class="generic-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
    `;
  }

  return preview;
}

function createInfo(upload) {
  const info = document.createElement('div');
  info.className = 'upload-info';

  const filename = document.createElement('div');
  filename.className = 'upload-filename';
  filename.textContent = upload.original_filename;
  filename.title = upload.original_filename;

  const meta = document.createElement('div');
  meta.className = 'upload-meta';

  const uploader = upload.uploaded_by ? `Uploaded by: ${escapeHtml(upload.uploaded_by)}` : 'Anonymous';
  const date = new Date(upload.created_at).toLocaleDateString();
  const size = formatFileSize(upload.size);

  meta.innerHTML = `
    <div>${escapeHtml(uploader)}</div>
    <div>${date}</div>
    <div>${size}</div>
  `;

  info.appendChild(filename);
  info.appendChild(meta);

  if (upload.caption) {
    const caption = document.createElement('div');
    caption.className = 'upload-caption';
    caption.textContent = `"${escapeHtml(upload.caption)}"`;
    info.appendChild(caption);
  }

  if (upload.archived_at && upload.backup_path) {
    const archivedPath = document.createElement('div');
    archivedPath.className = 'upload-archived-path';
    archivedPath.textContent = `MEGA: ${upload.backup_path}`;
    info.appendChild(archivedPath);
  }

  return info;
}

function createActions(upload) {
  const actions = document.createElement('div');
  actions.className = 'upload-actions';

  if (upload.archived_at) {
    const openButton = document.createElement('button');
    openButton.className = 'action-button open-terabox-button';
    openButton.textContent = upload.backup_link ? 'Open in MEGA' : 'Backed up (no link yet)';
    openButton.disabled = !upload.backup_link;
    openButton.onclick = () => {
      if (upload.backup_link) window.open(upload.backup_link, '_blank');
    };
    actions.appendChild(openButton);
  } else {
    const downloadButton = document.createElement('button');
    downloadButton.className = 'action-button download-button';
    downloadButton.textContent = 'Download';
    downloadButton.onclick = () => handleDownload(upload.id);
    actions.appendChild(downloadButton);
  }

  const deleteButton = document.createElement('button');
  deleteButton.className = 'action-button delete-button';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = () => handleDelete(upload.id, upload.original_filename);
  actions.appendChild(deleteButton);

  return actions;
}

function updatePagination(hasMore) {
  if (currentPage === 1 && !hasMore) {
    pagination.classList.add('hidden');
    return;
  }

  pagination.classList.remove('hidden');
  paginationInfo.textContent = `Page ${currentPage}`;

  prevButton.disabled = currentPage === 1;
  nextButton.disabled = !hasMore;
}

async function getSignedUrl(photoId) {
  const response = await fetch(`${SUPABASE_EDGE_FUNCTION_URL}/admin-download`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${sessionToken}`,
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ photoId })
  });

  if (response.status === 401) {
    sessionToken = null;
    dashboardSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    showLoginError('Session expired. Please login again.');
    throw new Error('Session expired');
  }

  if (!response.ok) {
    throw new Error('Failed to get signed URL');
  }

  const data = await response.json();
  return data.signedUrl;
}

async function handleDownload(photoId) {
  if (!sessionToken) return;

  try {
    const signedUrl = await getSignedUrl(photoId);

    // Create a temporary link to trigger download
    const link = document.createElement('a');
    link.href = signedUrl;
    link.download = '';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

  } catch (error) {
    console.error('Download error:', error);
    alert('Failed to download file. Please try again.');
  }
}

async function handleDelete(photoId, filename) {
  if (!sessionToken) return;

  const confirmed = confirm(`Are you sure you want to delete "${escapeHtml(filename)}"? This action cannot be undone.`);

  if (!confirmed) return;

  try {
    const response = await fetch(`${SUPABASE_EDGE_FUNCTION_URL}/admin-delete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`,
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ photoId })
    });

    if (response.status === 401) {
      sessionToken = null;
      dashboardSection.classList.add('hidden');
      loginSection.classList.remove('hidden');
      showLoginError('Session expired. Please login again.');
      return;
    }

    if (!response.ok) {
      throw new Error('Delete failed');
    }

    // Refresh the list
    fetchUploads();

  } catch (error) {
    console.error('Delete error:', error);
    alert('Failed to delete file. Please try again.');
  }
}

function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
