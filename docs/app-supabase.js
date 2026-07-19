// Elite Memories - Upload Application (Supabase Edition)
// Handles file uploads using Supabase Storage with resumable upload support

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// REPLACE THESE WITH YOUR SUPABASE CREDENTIALS
const SUPABASE_URL = 'https://cerlfqylakobkxnmweij.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_n2nb2F5ZdDVWC2LxXN8pPQ_qv0NJGV1';

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif', 'mp4', 'mov'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif'];
const VIDEO_EXTENSIONS = ['mp4', 'mov'];
const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_VIDEO_SIZE = 500 * 1024 * 1024; // 500MB
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // Exponential backoff

// State
let uploadQueue = [];
let activeUploads = 0;
let isPageVisible = true;
let allFilesComplete = false;
let supabase = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const selectButton = document.getElementById('select-button');
const uploaderNameInput = document.getElementById('uploader-name');
const captionInput = document.getElementById('caption');
const uploadSection = document.getElementById('upload-section');
const successSection = document.getElementById('success-section');
const queueSection = document.getElementById('queue-section');
const queueList = document.getElementById('queue-list');
const uploadMoreButton = document.getElementById('upload-more');
const qrCode = document.getElementById('qr-code');
const navigation = document.getElementById('navigation');

// Initialize
function init() {
  // Initialize Supabase client
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  setupEventListeners();
  generateQRCode();
  setupNavigationScroll();
}

function setupEventListeners() {
  // Drag and drop
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  dropZone.addEventListener('keydown', handleDropZoneKeydown);

  // File selection
  selectButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);

  // Upload more button
  uploadMoreButton.addEventListener('click', resetUploadForm);

  // Visibility handling
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

function setupNavigationScroll() {
  let lastScrollY = window.scrollY;
  let ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;

      // Hide on scroll down past 100px, show on scroll up
      if (currentScrollY > lastScrollY && currentScrollY > 100) {
        navigation.classList.add('hidden');
      } else {
        navigation.classList.remove('hidden');
      }

      // Compact/scrolled state — triggers blur increase + size reduction via CSS
      if (currentScrollY > 40) {
        navigation.classList.add('scrolled');
      } else {
        navigation.classList.remove('scrolled');
      }

      lastScrollY = currentScrollY;
      ticking = false;
    });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
}

function handleDropZoneKeydown(e) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
}

function handleDragOver(e) {
  e.preventDefault();
  dropZone.classList.add('drag-over');
}

function handleDragLeave(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
}

function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  // Trigger drop-confirm ripple animation
  dropZone.classList.add('drop-confirm');
  dropZone.addEventListener('animationend', () => {
    dropZone.classList.remove('drop-confirm');
  }, { once: true });

  const files = Array.from(e.dataTransfer.files);
  handleFiles(files);
}

function handleFileSelect(e) {
  const files = Array.from(e.target.files);
  handleFiles(files);
  fileInput.value = ''; // Reset input
}

function handleFiles(files) {
  const validFiles = [];

  for (const file of files) {
    const validation = validateFile(file);
    if (validation.valid) {
      validFiles.push(file);
    } else {
      alert(`${file.name}: ${validation.error}`);
    }
  }

  if (validFiles.length > 0) {
    addToQueue(validFiles);
    processQueue();
  }
}

function validateFile(file) {
  const ext = getExtension(file.name);

  // Check extension
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: 'Invalid file type. Allowed: jpg, jpeg, png, webp, heic, gif, mp4, mov' };
  }

  // Check size
  const isImage = IMAGE_EXTENSIONS.includes(ext);
  const isVideo = VIDEO_EXTENSIONS.includes(ext);

  if (isImage && file.size > MAX_IMAGE_SIZE) {
    return { valid: false, error: 'Image size exceeds 50MB limit' };
  }

  if (isVideo && file.size > MAX_VIDEO_SIZE) {
    return { valid: false, error: 'Video size exceeds 500MB limit' };
  }

  return { valid: true };
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

function addToQueue(files) {
  for (const file of files) {
    const uploadItem = {
      id: generateId(),
      file,
      status: 'queued',
      progress: 0,
      retryCount: 0
    };
    uploadQueue.push(uploadItem);
    renderQueueItem(uploadItem);
  }

  queueSection.classList.remove('hidden');
  updateQueueEmptyState();
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function renderQueueItem(uploadItem) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.id = `queue-item-${uploadItem.id}`;
  item.setAttribute('role', 'listitem');

  item.innerHTML = `
    <div class="queue-item-header">
      <span class="queue-item-name">${escapeHtml(uploadItem.file.name)}</span>
      <span class="queue-item-size">${formatFileSize(uploadItem.file.size)}</span>
    </div>
    <div class="queue-item-status queued" id="status-${uploadItem.id}">
      <svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      Queued
    </div>
    <div class="progress-bar">
      <div class="progress-bar-fill" id="progress-${uploadItem.id}" style="width: 0%"></div>
    </div>
    <div class="queue-item-actions" id="actions-${uploadItem.id}">
      <button class="pause-button icon-with-text" onclick="pauseUpload('${uploadItem.id}')" style="display:none" aria-label="Pause upload">
        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16"></rect>
          <rect x="14" y="4" width="4" height="16"></rect>
        </svg>
        Pause
      </button>
      <button class="resume-button icon-with-text" onclick="resumeUpload('${uploadItem.id}')" style="display:none" aria-label="Resume upload">
        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
        Resume
      </button>
      <button class="cancel-button icon-with-text" onclick="cancelUpload('${uploadItem.id}')" aria-label="Cancel upload">
        <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        Cancel
      </button>
    </div>
  `;

  queueList.appendChild(item);
}

function updateQueueEmptyState() {
  const queueEmpty = document.getElementById('queue-empty');
  const queueList = document.getElementById('queue-list');

  if (uploadQueue.length === 0) {
    queueEmpty.classList.remove('hidden');
    queueList.classList.add('hidden');
  } else {
    queueEmpty.classList.add('hidden');
    queueList.classList.remove('hidden');
  }
}

function updateQueueItemStatus(uploadItem, status, progress = null) {
  const statusEl = document.getElementById(`status-${uploadItem.id}`);
  const progressEl = document.getElementById(`progress-${uploadItem.id}`);
  const actionsEl = document.getElementById(`actions-${uploadItem.id}`);

  if (statusEl) {
    statusEl.className = `queue-item-status ${status}`;

    // Add appropriate icon based on status
    const statusIcons = {
      'queued': `<svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
      'uploading': `<svg class="icon icon-sm status-icon icon-spin" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`,
      'paused': `<svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><rect x="10" y="10" width="4" height="4"></rect></svg>`,
      'done': `<svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
      'failed': `<svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
      'cancelled': `<svg class="icon icon-sm status-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
    };

    const icon = statusIcons[status] || statusIcons['queued'];
    const text = status.charAt(0).toUpperCase() + status.slice(1);
    statusEl.innerHTML = `${icon} ${text}`;
  }

  if (progressEl && progress !== null) {
    progressEl.style.width = `${progress}%`;
  }

  if (actionsEl) {
    const pauseButton = actionsEl.querySelector('.pause-button');
    const resumeButton = actionsEl.querySelector('.resume-button');
    const cancelButton = actionsEl.querySelector('.cancel-button');

    if (status === 'failed') {
      actionsEl.innerHTML = `
        <button class="retry-button icon-with-text" onclick="retryUpload('${uploadItem.id}')" aria-label="Retry upload">
          <svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
          </svg>
          Retry
        </button>
      `;
    } else if (status === 'uploading') {
      // Show pause button for uploads
      if (pauseButton) pauseButton.style.display = 'inline';
      if (resumeButton) resumeButton.style.display = 'none';
      if (cancelButton) cancelButton.style.display = 'inline';
    } else if (status === 'paused') {
      // Show resume button for paused uploads
      if (pauseButton) pauseButton.style.display = 'none';
      if (resumeButton) resumeButton.style.display = 'inline';
      if (cancelButton) cancelButton.style.display = 'inline';
    } else {
      // Hide pause/resume for other statuses
      if (pauseButton) pauseButton.style.display = 'none';
      if (resumeButton) resumeButton.style.display = 'none';
      if (cancelButton) cancelButton.style.display = 'inline';
    }
  }
}

function processQueue() {
  if (!isPageVisible) return;

  while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
    const nextItem = uploadQueue.find(item => item.status === 'queued');
    if (!nextItem) break;

    activeUploads++;
    nextItem.status = 'uploading';
    updateQueueItemStatus(nextItem, 'uploading');

    uploadFile(nextItem);
  }
}

async function uploadFile(uploadItem) {
  try {
    // Only generate a new storage path on the first attempt — retries
    // must reuse the same path so the resumed upload and the DB row agree.
    if (!uploadItem.path) {
      const ext = getExtension(uploadItem.file.name);
      uploadItem.path = `uploads/${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`;
    }
    const path = uploadItem.path;

    await uploadFileResumable(uploadItem, path);

    // Insert into database
    const uploadedBy = uploaderNameInput.value.trim() || null;
    const caption = captionInput.value.trim() || null;

    const { error: dbError } = await supabase
      .from('photos')
      .insert({
        storage_path: path,
        original_filename: uploadItem.file.name,
        mime_type: uploadItem.file.type,
        size: uploadItem.file.size,
        uploaded_by: uploadedBy,
        caption: caption,
        ip_hash: null
      });

    if (dbError) {
      // If DB insert fails, try to delete the uploaded file
      await supabase.storage.from('elite-memories').remove([path]);
      throw dbError;
    }

    uploadItem.status = 'done';
    updateQueueItemStatus(uploadItem, 'done', 100);
    activeUploads--;

    checkAllComplete();
    processQueue();

  } catch (error) {
    console.error('Upload error:', error);
    handleUploadError(uploadItem, error);
  }
}

function uploadFileResumable(uploadItem, path) {
  return new Promise((resolve, reject) => {
    // Reuse an existing tus.Upload instance if this is a retry —
    // that's what makes resume actually resume instead of restarting.
    if (!uploadItem.tusUpload) {
      uploadItem.tusUpload = new tus.Upload(uploadItem.file, {
        endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
        retryDelays: [0, 1000, 3000, 5000], // tus's own internal retry, separate from our queue-level retry
        headers: {
          authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: 'elite-memories',
          objectName: path,
          contentType: uploadItem.file.type || 'application/octet-stream',
          cacheControl: '3600',
        },
        chunkSize: 6 * 1024 * 1024, // 6MB, required minimum for Supabase's resumable endpoint
        onError: (error) => {
          reject(error);
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          updateQueueItemStatus(uploadItem, 'uploading', percent);
        },
        onSuccess: () => {
          resolve();
        },
      });
    }

    // .start() on an existing instance resumes from the last acknowledged
    // chunk (tus tracks this via an upload URL it gets from the server on
    // first attempt). On a brand new instance it just starts normally.
    uploadItem.tusUpload.start();
  });
}

function handleUploadError(uploadItem, error) {
  uploadItem.retryCount++;

  if (uploadItem.retryCount <= MAX_RETRIES) {
    // Retry with exponential backoff
    uploadItem.status = 'retrying';
    updateQueueItemStatus(uploadItem, 'retrying');

    const delay = RETRY_DELAYS[uploadItem.retryCount - 1];
    setTimeout(() => {
      if (isPageVisible) {
        uploadItem.status = 'queued';
        updateQueueItemStatus(uploadItem, 'queued');
        activeUploads--;
        processQueue();
      }
    }, delay);
  } else {
    // Max retries reached, show manual retry button
    uploadItem.status = 'failed';
    updateQueueItemStatus(uploadItem, 'failed');
    activeUploads--;
    processQueue();
  }
}

function retryUpload(uploadItemId) {
  const uploadItem = uploadQueue.find(item => item.id === uploadItemId);
  if (!uploadItem) return;

  uploadItem.retryCount = 0;
  uploadItem.status = 'queued';
  updateQueueItemStatus(uploadItem, 'queued', 0);
  processQueue();
}

function pauseUpload(uploadItemId) {
  const uploadItem = uploadQueue.find(item => item.id === uploadItemId);
  if (!uploadItem || !uploadItem.tusUpload) return;

  uploadItem.tusUpload.abort(); // stops the transfer, keeps server-side progress
  uploadItem.status = 'paused';
  activeUploads--;
  updateQueueItemStatus(uploadItem, 'paused');
  processQueue(); // let another queued item take the freed slot
}

function resumeUpload(uploadItemId) {
  const uploadItem = uploadQueue.find(item => item.id === uploadItemId);
  if (!uploadItem || !uploadItem.tusUpload) return;

  activeUploads++;
  uploadItem.status = 'uploading';
  updateQueueItemStatus(uploadItem, 'uploading');
  uploadItem.tusUpload.start(); // resumes from last acknowledged chunk
}

function cancelUpload(uploadItemId) {
  const uploadItem = uploadQueue.find(item => item.id === uploadItemId);
  if (!uploadItem) return;

  if (uploadItem.tusUpload) {
    uploadItem.tusUpload.abort(true); // true = also tell the server to discard the partial upload
  }
  if (uploadItem.status === 'uploading' || uploadItem.status === 'paused') {
    activeUploads--;
  }
  uploadQueue = uploadQueue.filter(item => item.id !== uploadItemId);
  const queueItem = document.getElementById(`queue-item-${uploadItemId}`);
  if (queueItem) {
    queueItem.remove();
  }
  updateQueueEmptyState();
  processQueue();
}

function checkAllComplete() {
  const allDone = uploadQueue.every(item => item.status === 'done');
  if (allDone && !allFilesComplete) {
    allFilesComplete = true;
    showSuccess();
  }
}

function showSuccess() {
  uploadSection.classList.add('hidden');
  queueSection.classList.add('hidden');
  successSection.classList.remove('hidden');
}

function resetUploadForm() {
  uploadQueue = [];
  queueList.innerHTML = '';
  uploaderNameInput.value = '';
  captionInput.value = '';
  allFilesComplete = false;

  successSection.classList.add('hidden');
  uploadSection.classList.remove('hidden');
  queueSection.classList.add('hidden');
}

function handleVisibilityChange() {
  isPageVisible = !document.hidden;

  if (isPageVisible) {
    // Page became visible, resume processing queue
    processQueue();
  }
  // If page becomes hidden, in-flight uploads continue but we don't start new ones
}

function generateQRCode() {
  // Use QR Server API to generate QR code pointing to current URL
  const currentUrl = window.location.href;
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(currentUrl)}`;
  qrCode.src = qrApiUrl;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions available globally for onclick handlers
window.retryUpload = retryUpload;
window.pauseUpload = pauseUpload;
window.resumeUpload = resumeUpload;
window.cancelUpload = cancelUpload;

// ============================================================
// PARALLAX SYSTEM — Photo stack signature microinteraction
// ============================================================
//
// Design constraints (spec):
//   - Max card translation: 6px
//   - Max extra rotation:   2deg
//   - Shadows respond naturally
//   - Touch: device tilt if available, otherwise idle drift
//   - Must feel calm, never playful or distracting
//   - Disabled entirely when prefers-reduced-motion is set
// ============================================================

function initParallax() {
  // Respect user's motion preference unconditionally
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const stack = document.getElementById('photo-stack');
  if (!stack) return;

  const cards = Array.from(stack.querySelectorAll('.photo-card'));
  if (cards.length === 0) return;

  // Read per-card depth multiplier from data-depth attribute (0.0–1.0)
  // Higher depth = more movement = "closer to camera"
  const depths = cards.map(c => parseFloat(c.dataset.depth ?? '0.5'));

  // Base rotations parsed from the CSS transform applied at card creation time
  // We preserve them so parallax adds to — not replaces — the stacked angle
  const baseRotations = cards.map(c => {
    const style = window.getComputedStyle(c);
    const matrix = style.transform;
    if (!matrix || matrix === 'none') return 0;
    // matrix(cos, sin, -sin, cos, tx, ty) — extract angle from sin value
    const values = matrix.replace(/matrix\(|\)/g, '').split(',');
    if (values.length < 2) return 0;
    return Math.round(Math.atan2(parseFloat(values[1]), parseFloat(values[0])) * (180 / Math.PI));
  });

  // Current interpolated state (separate from raw mouse position for smooth lerp)
  let current = { x: 0, y: 0 };
  let target = { x: 0, y: 0 };
  let rafId = null;
  let isTouch = false;

  // Max offsets (px and deg — spec: ≤6px, ≤2deg)
  const MAX_TRANSLATE = 5;   // px
  const MAX_ROTATE = 1.6; // deg

  // Lerp factor — lower = smoother/slower response
  const LERP_FACTOR = 0.06;

  // -----------------------------------------------------------
  // Apply transforms to each card based on normalized offset
  // nx, ny: -1 to +1 representing cursor position in hero bounds
  // -----------------------------------------------------------
  function applyTransforms(nx, ny) {
    cards.forEach((card, i) => {
      const d = depths[i];
      const tx = nx * MAX_TRANSLATE * d;
      const ty = ny * MAX_TRANSLATE * d * 0.6; // vertical feels more natural at 60%
      const rz = baseRotations[i] + (-nx * MAX_ROTATE * d);

      // Shadow depth responds to parallax: front card shadow grows slightly
      const shadowBase = 0.55 + d * 0.2;
      const shadowBlur = Math.round(8 + d * 24 + Math.abs(nx) * 8);

      card.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) rotate(${rz.toFixed(2)}deg)`;
      card.style.boxShadow = [
        `0 ${shadowBlur}px ${shadowBlur * 2.5}px rgba(0,0,0,${shadowBase.toFixed(2)})`,
        `0 2px 8px rgba(0,0,0,0.45)`,
      ].join(', ');
    });
  }

  // -----------------------------------------------------------
  // Mouse / pointer handler
  // Normalizes cursor position relative to the hero section
  // -----------------------------------------------------------
  function onPointerMove(e) {
    const hero = document.getElementById('hero');
    if (!hero) return;

    const rect = hero.getBoundingClientRect();
    // nx/ny: -1 (left/top) to +1 (right/bottom)
    const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
    const ny = ((e.clientY - rect.top) / rect.height - 0.5) * 2;

    // Clamp to [-1, 1] and attenuate so edges don't feel extreme
    target.x = Math.max(-1, Math.min(1, nx)) * 0.75;
    target.y = Math.max(-1, Math.min(1, ny)) * 0.75;
  }

  function onPointerLeave() {
    // Gently float back to center
    target.x = 0;
    target.y = 0;
  }

  // -----------------------------------------------------------
  // Device orientation (tilt) for touch devices
  // -----------------------------------------------------------
  function onDeviceOrientation(e) {
    // gamma: left-right tilt (-90 to 90)
    // beta:  front-back tilt (-180 to 180), clamped to [-45, 45]
    const gamma = e.gamma ?? 0;
    const beta = e.beta ?? 0;

    // Normalize to -1..1 with gentle range
    target.x = Math.max(-1, Math.min(1, gamma / 25)) * 0.7;
    target.y = Math.max(-1, Math.min(1, (beta - 20) / 30)) * 0.5;
  }

  // -----------------------------------------------------------
  // Idle drift — used when no pointer/tilt input is active
  // Very slow sinusoidal motion so the cards never feel static
  // -----------------------------------------------------------
  let idleActive = false;
  let idleStart = 0;

  function startIdleDrift() {
    idleActive = true;
    idleStart = performance.now();
  }

  function stopIdleDrift() {
    idleActive = false;
  }

  // Idle target is updated in the rAF loop when active
  function updateIdleTarget(now) {
    if (!idleActive) return;
    const t = (now - idleStart) / 1000; // seconds
    // Very gentle Lissajous-like drift — max ±0.25 normalized
    target.x = Math.sin(t * 0.18) * 0.22;
    target.y = Math.sin(t * 0.13 + 1.2) * 0.18;
  }

  // animateWithIdle replaces animate — combines lerp with idle target updates
  function animateWithIdle() {
    updateIdleTarget(performance.now());

    const dx = target.x - current.x;
    const dy = target.y - current.y;

    if (Math.abs(dx) > 0.0005 || Math.abs(dy) > 0.0005) {
      current.x += dx * LERP_FACTOR;
      current.y += dy * LERP_FACTOR;
      applyTransforms(current.x, current.y);
    }

    rafId = requestAnimationFrame(animateWithIdle);
  }

  // -----------------------------------------------------------
  // Attach listeners
  // -----------------------------------------------------------
  const hero = document.getElementById('hero');
  if (!hero) return;

  // Check touch capability
  isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  if (isTouch) {
    // Try device orientation first
    if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires permission
      // We request on first user gesture (tap anywhere on hero)
      hero.addEventListener('touchstart', function askPermission() {
        DeviceOrientationEvent.requestPermission()
          .then(state => {
            if (state === 'granted') {
              window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
              stopIdleDrift();
            }
          })
          .catch(() => {/* silently fall back to idle */ });
        hero.removeEventListener('touchstart', askPermission);
      }, { once: true });
    } else if (typeof DeviceOrientationEvent !== 'undefined') {
      // Android / older devices — no permission needed
      window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
    }

    // Start idle drift as the baseline for touch devices
    startIdleDrift();
    rafId = requestAnimationFrame(animateWithIdle);

  } else {
    // Desktop — pointer-driven parallax
    hero.addEventListener('pointermove', onPointerMove, { passive: true });
    hero.addEventListener('pointerleave', onPointerLeave, { passive: true });

    // Start idle until pointer enters
    startIdleDrift();
    hero.addEventListener('pointerenter', () => {
      stopIdleDrift();
    }, { passive: true });
    hero.addEventListener('pointerleave', () => {
      startIdleDrift();
    }, { passive: true });

    rafId = requestAnimationFrame(animateWithIdle);
  }

  // Clean up rAF if page becomes hidden (battery)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
    } else {
      rafId = requestAnimationFrame(animateWithIdle);
    }
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init();
    initParallax();
  });
} else {
  init();
  initParallax();
}
