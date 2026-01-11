// Get the blocked site from the query parameter
const params = new URLSearchParams(window.location.search);
const site = params.get('site');
const url = params.get('url');

// Check if we should redirect to the actual site
// Only do this if blocking is OFF (to escape old cached redirects)
(async () => {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled']);
    if (!result.blockingEnabled && (site || url)) {
      // Blocking is OFF - redirect to actual site
      const targetSite = site || url;
      let redirectUrl = targetSite;
      if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
        redirectUrl = 'https://' + redirectUrl.replace(/^\*/, '');
      }
      window.location.replace(redirectUrl);
    }
  } catch (e) {}
})();

// Extract site name from domain (fallback if redirect doesn't happen)
function extractSiteName(input) {
  if (!input) return null;
  let domain = input;
  
  // Strip protocol
  domain = domain.replace(/^https?:\/\//, '');
  // Strip leading * and path
  domain = domain.replace(/^\*/, '').split('/')[0].replace(/^www\./, '');
  
  // Get the main domain name (second-to-last part before TLD)
  const parts = domain.split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Display blocked site
const blockedSiteEl = document.getElementById('blockedSite');
const displaySite = extractSiteName(site) || extractSiteName(url) || 'This site';
blockedSiteEl.textContent = displaySite;

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
    statusLineEl.textContent = 'Pip is keeping you focused';
    return;
  }
  
  const remaining = Math.max(0, Math.floor((currentEndTime - Date.now()) / 1000));
  if (remaining > 0) {
    const timeStr = formatTimeMinutes(remaining);
    statusLineEl.textContent = `Pip is keeping you focused · Unblocks in ${timeStr}`;
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
    statusLineEl.textContent = 'Pip is keeping you focused';
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
