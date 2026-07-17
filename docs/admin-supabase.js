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

  const ext = getExtension(upload.original_filename);
  const isImage = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext);
  const isVideo = ['mp4', 'mov'].includes(ext);
  const isHeic = ext === 'heic';

  if (isImage && !isHeic) {
    // Get signed URL for image preview
    try {
      const signedUrl = await getSignedUrl(upload.id);
      const img = document.createElement('img');
      img.src = signedUrl;
      img.alt = escapeHtml(upload.original_filename);
      img.loading = 'lazy';
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
      preview.appendChild(video);
    } catch {
      preview.innerHTML = '<div class="preview-placeholder">🎬</div>';
    }
  } else {
    // HEIC or other - show generic icon
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

  return info;
}

function createActions(upload) {
  const actions = document.createElement('div');
  actions.className = 'upload-actions';

  const downloadButton = document.createElement('button');
  downloadButton.className = 'action-button download-button';
  downloadButton.textContent = 'Download';
  downloadButton.onclick = () => handleDownload(upload.id);

  const deleteButton = document.createElement('button');
  deleteButton.className = 'action-button delete-button';
  deleteButton.textContent = 'Delete';
  deleteButton.onclick = () => handleDelete(upload.id, upload.original_filename);

  actions.appendChild(downloadButton);
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
