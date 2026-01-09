// Get the blocked site from the query parameter
const params = new URLSearchParams(window.location.search);
const site = params.get('site');
const url = params.get('url');

// Display blocked site
const blockedSiteEl = document.getElementById('blockedSite');
if (site) {
  blockedSiteEl.textContent = site;
} else if (url) {
  try {
    const parsedUrl = new URL(url);
    blockedSiteEl.textContent = parsedUrl.hostname;
  } catch {
    blockedSiteEl.textContent = url;
  }
} else {
  blockedSiteEl.textContent = 'This site';
}

// Status line element
const statusLineEl = document.getElementById('statusLine');

// State
let timerInterval = null;
let storageListener = null;
let currentEndTime = null;

function formatTimeMinutes(seconds) {
  if (seconds <= 0) return null;
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    return 'less than a minute';
  }
}

function updateStatusLine() {
  if (!currentEndTime) {
    statusLineEl.textContent = 'Focus Mode active';
    return;
  }
  
  const remaining = Math.max(0, Math.floor((currentEndTime - Date.now()) / 1000));
  if (remaining > 0) {
    const timeStr = formatTimeMinutes(remaining);
    statusLineEl.textContent = `Focus Mode active · Unblocks in ${timeStr}`;
  } else {
    statusLineEl.textContent = 'Unblocking...';
  }
}

// Storage change listener
storageListener = (changes, areaName) => {
  if (areaName !== 'sync' && areaName !== 'local') return;
  
  if (changes.blockingEnabled?.newValue === false) {
    cleanup();
    window.history.back();
    return;
  }
  
  if (changes.blockingEndTime !== undefined) {
    currentEndTime = changes.blockingEndTime.newValue;
    updateStatusLine();
  }
};

// Initial load from storage
async function initialize() {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled', 'blockingEndTime']);
    
    if (!result.blockingEnabled) {
      window.history.back();
      return;
    }
    
    currentEndTime = result.blockingEndTime || null;
    updateStatusLine();
    
    timerInterval = setInterval(updateStatusLine, 60000); // Update every minute
    chrome.storage.onChanged.addListener(storageListener);
  } catch (e) {
    statusLineEl.textContent = 'Focus Mode active';
  }
}

function cleanup() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (storageListener) {
    chrome.storage.onChanged.removeListener(storageListener);
    storageListener = null;
  }
}

window.addEventListener('beforeunload', cleanup);

// Open extension settings
document.getElementById('openSettings')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }).catch(() => {});
});

initialize();
