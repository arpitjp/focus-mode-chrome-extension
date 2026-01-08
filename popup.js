// DOM elements
const blockingToggle = document.getElementById('blockingToggle');
const statusText = document.getElementById('statusText');
const siteInput = document.getElementById('siteInput');
const addSiteBtn = document.getElementById('addSiteBtn');
const blockedSitesList = document.getElementById('blockedSitesList');

// Save to both sync (Google account) and local storage for persistence
async function saveToBothStorages(data) {
  try {
    // Save to sync storage (Google account - syncs across devices)
    await chrome.storage.sync.set(data);
    // Also save to local storage (persists across uninstall/reinstall)
    await chrome.storage.local.set(data);
  } catch (error) {
    console.error('Error saving to sync storage:', error);
    // If sync fails (quota exceeded), at least save locally
    await chrome.storage.local.set(data);
  }
}

// Load saved state from both sync and local storage
async function loadState() {
  // Check both sync (Google account) and local storage
  const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
  const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
  
  // Prefer sync storage, fallback to local
  const blockingEnabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
  const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
  
  blockingToggle.checked = blockingEnabled;
  updateStatusText();
  displayBlockedSites(blockedSites);
  
  // Ensure both storages are in sync
  await saveToBothStorages({ blockingEnabled, blockedSites });
}

// Update status text based on toggle state
function updateStatusText() {
  statusText.textContent = blockingToggle.checked ? 'On' : 'Off';
  statusText.style.color = blockingToggle.checked ? '#667eea' : '#999';
}

// Display blocked sites list
function displayBlockedSites(sites) {
  blockedSitesList.innerHTML = '';
  
  if (sites.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No blocked sites. Add one above.';
    blockedSitesList.appendChild(emptyState);
    return;
  }

  sites.forEach((site, index) => {
    const li = document.createElement('li');
    const siteName = document.createElement('span');
    siteName.className = 'site-name';
    siteName.textContent = site;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => removeSite(index));
    
    li.appendChild(siteName);
    li.appendChild(deleteBtn);
    blockedSitesList.appendChild(li);
  });
}

// Toggle blocking on/off
blockingToggle.addEventListener('change', async () => {
  const enabled = blockingToggle.checked;
  await saveToBothStorages({ blockingEnabled: enabled });
  updateStatusText();
  
  // Notify background script to update blocking rules
  chrome.runtime.sendMessage({ action: 'updateBlocking', enabled });
});

// Add a site to blocked list
addSiteBtn.addEventListener('click', async () => {
  const site = siteInput.value.trim();
  if (!site) {
    alert('Please enter a website');
    return;
  }

  // Normalize the site (remove protocol, www, trailing slash)
  const normalizedSite = normalizeSite(site);
  
  // Check both storages
  const syncResult = await chrome.storage.sync.get(['blockedSites']);
  const localResult = await chrome.storage.local.get(['blockedSites']);
  const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
  
  if (blockedSites.includes(normalizedSite)) {
    alert('This site is already blocked');
    return;
  }

  blockedSites.push(normalizedSite);
  await saveToBothStorages({ blockedSites });
  
  siteInput.value = '';
  displayBlockedSites(blockedSites);
  
  // Notify background script to update blocking rules
  chrome.runtime.sendMessage({ action: 'updateRules', sites: blockedSites });
});

// Remove a site from blocked list
async function removeSite(index) {
  // Check both storages
  const syncResult = await chrome.storage.sync.get(['blockedSites']);
  const localResult = await chrome.storage.local.get(['blockedSites']);
  const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
  blockedSites.splice(index, 1);
  await saveToBothStorages({ blockedSites });
  displayBlockedSites(blockedSites);
  
  // Notify background script to update blocking rules
  chrome.runtime.sendMessage({ action: 'updateRules', sites: blockedSites });
}

// Normalize site URL
function normalizeSite(site) {
  return site
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
    .toLowerCase();
}

// Allow Enter key to add site
siteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addSiteBtn.click();
  }
});

// Initialize
loadState();

