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

// Initialize
function init() {
  // Initialize Supabase client
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  
  setupEventListeners();
  generateQRCode();
}

function setupEventListeners() {
  // Drag and drop
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  
  // File selection
  selectButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  
  // Upload more button
  uploadMoreButton.addEventListener('click', resetUploadForm);
  
  // Visibility handling
  document.addEventListener('visibilitychange', handleVisibilityChange);
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
}

function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

function renderQueueItem(uploadItem) {
  const item = document.createElement('div');
  item.className = 'queue-item';
  item.id = `queue-item-${uploadItem.id}`;
  
  item.innerHTML = `
    <div class="queue-item-header">
      <span class="queue-item-name">${escapeHtml(uploadItem.file.name)}</span>
      <span class="queue-item-size">${formatFileSize(uploadItem.file.size)}</span>
    </div>
    <div class="queue-item-status queued" id="status-${uploadItem.id}">Queued</div>
    <div class="progress-bar">
      <div class="progress-bar-fill" id="progress-${uploadItem.id}" style="width: 0%"></div>
    </div>
    <div class="queue-item-actions" id="actions-${uploadItem.id}">
      <button class="pause-button" onclick="pauseUpload('${uploadItem.id}')" style="display:none">Pause</button>
      <button class="resume-button" onclick="resumeUpload('${uploadItem.id}')" style="display:none">Resume</button>
      <button class="cancel-button" onclick="cancelUpload('${uploadItem.id}')">Cancel</button>
    </div>
  `;
  
  queueList.appendChild(item);
}

function updateQueueItemStatus(uploadItem, status, progress = null) {
  const statusEl = document.getElementById(`status-${uploadItem.id}`);
  const progressEl = document.getElementById(`progress-${uploadItem.id}`);
  const actionsEl = document.getElementById(`actions-${uploadItem.id}`);
  
  if (statusEl) {
    statusEl.className = `queue-item-status ${status}`;
    statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
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
        <button class="retry-button" onclick="retryUpload('${uploadItem.id}')">Retry</button>
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
  processQueue();
}

// Make functions available globally for onclick handlers
window.retryUpload = retryUpload;
window.pauseUpload = pauseUpload;
window.resumeUpload = resumeUpload;
window.cancelUpload = cancelUpload;

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
