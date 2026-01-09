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
  blockedSiteEl.textContent = 'Website blocked';
}

// Timer elements
const timerValueEl = document.getElementById('timerValue');

// State
let timerInterval = null;
let storageListener = null;
let currentEndTime = null;

function formatTime(seconds) {
  if (seconds <= 0) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function updateTimerDisplay() {
  if (!currentEndTime) {
    timerValueEl.textContent = '∞';
    return;
  }
  
  const remaining = Math.max(0, Math.floor((currentEndTime - Date.now()) / 1000));
  if (remaining > 0) {
    timerValueEl.textContent = formatTime(remaining);
  } else {
    timerValueEl.textContent = 'Done!';
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
    updateTimerDisplay();
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
    updateTimerDisplay();
    
    timerInterval = setInterval(updateTimerDisplay, 1000);
    chrome.storage.onChanged.addListener(storageListener);
  } catch (e) {
    timerValueEl.textContent = '∞';
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
