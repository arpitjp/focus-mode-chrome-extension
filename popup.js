// DOM elements
const blockingToggle = document.getElementById('blockingToggle');
const siteInput = document.getElementById('siteInput');
const addSiteBtn = document.getElementById('addSiteBtn');
const blockedSitesList = document.getElementById('blockedSitesList');
const durationContainer = document.getElementById('durationContainer');
const durationSelect = document.getElementById('durationSelect');
const customDuration = document.getElementById('customDuration');
const customMinutes = document.getElementById('customMinutes');
const timerText = document.getElementById('timerText');

let countdownInterval = null;

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Single storage change listener for all updates
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' && areaName !== 'local') return;
  
  // Handle blocking disabled by background
  if (changes.blockingEnabled?.newValue === false) {
    blockingToggle.checked = false;
    durationContainer.style.display = 'none';
    stopCountdown();
  }
  
  // Handle blocked sites updated (e.g., from sync)
  if (changes.blockedSites?.newValue) {
    displayBlockedSites(changes.blockedSites.newValue);
  }
});

// Save to sync storage (persists across uninstall/reinstall with Chrome sync enabled)
async function saveToStorage(data) {
  try {
    await chrome.storage.sync.set(data);
  } catch (e) {
    // Sync failed - data won't persist across reinstall
    // but will work within current install via local storage fallback
    await chrome.storage.local.set(data).catch(() => {});
  }
}

// Load saved state from sync storage
async function loadState() {
  try {
    const syncResult = await chrome.storage.sync.get([
      'blockingEnabled', 'blockedSites', 'blockingEndTime', 
      'blockingDuration', 'lastDurationOption', 'lastCustomMinutes'
    ]);
    
    const blockingEnabled = syncResult.blockingEnabled ?? false;
    const blockedSites = syncResult.blockedSites ?? [];
    const blockingEndTime = syncResult.blockingEndTime ?? null;
    const blockingDuration = syncResult.blockingDuration ?? null;
    const lastDurationOption = syncResult.lastDurationOption ?? 'infinite';
    const lastCustomMinutes = syncResult.lastCustomMinutes ?? null;
    
    blockingToggle.checked = blockingEnabled;
    displayBlockedSites(blockedSites);
    
    // Set the last selected duration option
    durationSelect.value = lastDurationOption;
    if (lastDurationOption === 'custom' && lastCustomMinutes) {
      customMinutes.value = lastCustomMinutes;
      customDuration.style.display = 'flex';
    } else {
      customDuration.style.display = 'none';
    }
    
    // Show duration dropdown if enabled
    if (blockingEnabled) {
      durationContainer.style.display = 'block';
      if (blockingEndTime && blockingDuration !== 'infinite') {
        startCountdown(blockingEndTime);
      }
    } else {
      durationContainer.style.display = 'none';
      stopCountdown();
    }
  } catch (e) {
    // Storage read failed - show empty state
    displayBlockedSites([]);
  }
}

// Format time remaining
function formatTimeRemaining(seconds) {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

// Start countdown timer
function startCountdown(endTime) {
  stopCountdown();
  
  const updateTimer = () => {
    const now = Date.now();
    const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
    
    if (remaining > 0) {
      timerText.textContent = `Auto-off in ${formatTimeRemaining(remaining)}`;
      timerText.style.display = 'block';
    } else {
      timerText.textContent = 'Ending...';
      timerText.style.display = 'block';
      // Don't auto-disable here - let background handle it
    }
  };
  
  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

// Stop countdown timer
function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  timerText.style.display = 'none';
}

// Get duration in minutes (returns null for infinite)
function getDurationMinutes() {
  const selectedValue = durationSelect.value;
  if (selectedValue === 'infinite') {
    return null;
  }
  if (selectedValue === 'custom') {
    const customMins = parseInt(customMinutes.value, 10);
    return customMins && customMins > 0 ? customMins : null;
  }
  return parseFloat(selectedValue);
}

// Display blocked sites list
function displayBlockedSites(sites) {
  blockedSitesList.innerHTML = '';
  const isBlocking = blockingToggle.checked;
  
  if (!sites || sites.length === 0) {
    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No blocked sites. Add one above.';
    blockedSitesList.appendChild(emptyState);
    return;
  }

  sites.forEach((site) => {
    const li = document.createElement('li');
    const siteName = document.createElement('span');
    siteName.className = 'site-name';
    if (site.startsWith('*')) {
      siteName.innerHTML = '<span class="wildcard">*</span>' + escapeHtml(site.slice(1));
    } else {
      siteName.textContent = site;
    }
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
    
    if (isBlocking) {
      deleteBtn.disabled = true;
      deleteBtn.title = "Can't delete while blocking is on";
      deleteBtn.classList.add('disabled');
    } else {
      deleteBtn.addEventListener('click', () => removeSite(site));
    }
    
    li.appendChild(siteName);
    li.appendChild(deleteBtn);
    blockedSitesList.appendChild(li);
  });
}

// Handle toggle change
async function handleToggleChange() {
  const enabled = blockingToggle.checked;
  const selectedDuration = durationSelect.value;
  
  // Save the last selected duration option
  await saveToStorage({ 
    lastDurationOption: selectedDuration,
    lastCustomMinutes: selectedDuration === 'custom' ? customMinutes.value : null
  });
  
  // Refresh the sites list to update delete button state
  const result = await chrome.storage.sync.get(['blockedSites']);
  displayBlockedSites(result.blockedSites ?? []);
  
  if (enabled) {
    durationContainer.style.display = 'block';
    await saveToStorage({ blockingEnabled: enabled });
    
    const durationMinutes = getDurationMinutes();
    if (durationMinutes) {
      const endTime = Date.now() + (durationMinutes * 60 * 1000);
      await saveToStorage({ 
        blockingEndTime: endTime,
        blockingDuration: selectedDuration,
        customMinutes: selectedDuration === 'custom' ? durationMinutes : null
      });
      startCountdown(endTime);
      
      // Notify background script with timer info
      chrome.runtime.sendMessage({ 
        action: 'updateBlocking', 
        enabled,
        endTime,
        duration: selectedDuration
      }).catch(() => {});
    } else {
      // Infinite or no valid duration
      await saveToStorage({ 
        blockingEndTime: null,
        blockingDuration: selectedDuration
      });
      stopCountdown();
      chrome.runtime.sendMessage({ action: 'updateBlocking', enabled }).catch(() => {});
    }
  } else {
    durationContainer.style.display = 'none';
    customDuration.style.display = 'none';
    stopCountdown();
    await saveToStorage({ 
      blockingEnabled: enabled,
      blockingEndTime: null,
      blockingDuration: null
    });
    chrome.runtime.sendMessage({ action: 'updateBlocking', enabled }).catch(() => {});
  }
}

// Toggle blocking on/off
blockingToggle.addEventListener('change', handleToggleChange);

// Handle duration selection change
durationSelect.addEventListener('change', async () => {
  const selectedValue = durationSelect.value;
  
  await saveToStorage({ 
    lastDurationOption: selectedValue,
    lastCustomMinutes: selectedValue === 'custom' ? customMinutes.value : null
  });
  
  if (selectedValue === 'custom') {
    customDuration.style.display = 'flex';
    customMinutes.focus();
  } else {
    customDuration.style.display = 'none';
    if (blockingToggle.checked) {
      handleToggleChange();
    }
  }
});

// Handle custom minutes input (debounced)
let customMinutesTimeout = null;
customMinutes.addEventListener('input', () => {
  // Debounce to avoid excessive updates
  if (customMinutesTimeout) clearTimeout(customMinutesTimeout);
  customMinutesTimeout = setTimeout(async () => {
    await saveToStorage({ lastCustomMinutes: customMinutes.value });
    
    if (blockingToggle.checked && durationSelect.value === 'custom') {
      const minutes = getDurationMinutes();
      if (minutes && minutes > 0) {
        handleToggleChange();
      }
    }
  }, 300);
});

// Handle custom minutes enter key
customMinutes.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    const minutes = getDurationMinutes();
    if (minutes && minutes > 0) {
      blockingToggle.checked = true;
      handleToggleChange();
    }
  }
});

// Normalize site URL
// youtube.com → *youtube.com (wildcard, blocks all subdomains)
// *youtube.com → *youtube.com (wildcard, blocks all subdomains)
// https://youtube.com → https://youtube.com (exact domain only, NOT subdomains)
function normalizeSite(site) {
  const trimmed = site.trim().toLowerCase();
  
  // Explicit wildcard - keep as-is
  if (trimmed.startsWith('*')) {
    return trimmed.replace(/\/$/, '');
  }
  
  // Full URL with protocol - keep as-is for exact domain matching
  if (/^https?:\/\//.test(trimmed)) {
    return trimmed.replace(/\/$/, '');
  }
  
  // Plain domain - add * prefix for wildcard matching
  const cleaned = trimmed.replace(/^www\./, '').replace(/\/$/, '');
  return '*' + cleaned;
}

// Add a site to blocked list
addSiteBtn.addEventListener('click', async () => {
  const site = siteInput.value.trim();
  if (!site) {
    alert('Please enter a website');
    return;
  }

  const normalizedSite = normalizeSite(site);
  
  try {
    const result = await chrome.storage.sync.get(['blockedSites']);
    const blockedSites = result.blockedSites ?? [];
    
    if (blockedSites.includes(normalizedSite)) {
      alert('This site is already blocked');
      return;
    }

    blockedSites.unshift(normalizedSite);
    await saveToStorage({ blockedSites });
    
    siteInput.value = '';
    displayBlockedSites(blockedSites);
    
    // Notify background script
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'updateRules' }).catch(() => {});
    }, 50);
  } catch (e) {
    alert('Error adding site. Please try again.');
  }
});

// Remove a site from blocked list
async function removeSite(site) {
  try {
    const result = await chrome.storage.sync.get(['blockedSites']);
    const blockedSites = result.blockedSites ?? [];
    const updatedSites = blockedSites.filter(s => s !== site);
    await saveToStorage({ blockedSites: updatedSites });
    displayBlockedSites(updatedSites);
    
    setTimeout(() => {
      chrome.runtime.sendMessage({ action: 'updateRules' }).catch(() => {});
    }, 50);
  } catch (e) {
    alert('Error removing site. Please try again.');
  }
}

// Allow Enter key to add site
siteInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addSiteBtn.click();
  }
});

// Export blocked sites to JSON file
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const result = await chrome.storage.sync.get(['blockedSites']);
    const blockedSites = result.blockedSites || [];
    
    if (blockedSites.length === 0) {
      alert('No sites to export');
      return;
    }
    
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      blockedSites: blockedSites
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-mode-sites-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error exporting sites');
  }
});

// Import blocked sites from JSON file
const importFile = document.getElementById('importFile');

document.getElementById('importBtn').addEventListener('click', () => {
  importFile.click();
});

importFile.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.blockedSites || !Array.isArray(data.blockedSites)) {
      alert('Invalid file format');
      return;
    }
    
    const result = await chrome.storage.sync.get(['blockedSites']);
    const existingSites = result.blockedSites || [];
    
    // Merge and dedupe
    const allSites = [...new Set([...existingSites, ...data.blockedSites])];
    
    await saveToStorage({ blockedSites: allSites });
    displayBlockedSites(allSites);
    
    chrome.runtime.sendMessage({ action: 'updateRules' }).catch(() => {});
    
    const newCount = allSites.length - existingSites.length;
    alert(`Imported ${newCount} new sites (${allSites.length} total)`);
  } catch (e) {
    alert('Error importing file: Invalid JSON format');
  }
  
  // Reset file input
  importFile.value = '';
});

// Hide test timer option if not in development mode
chrome.management.getSelf((info) => {
  if (info.installType !== 'development') {
    const testOption = document.getElementById('testTimerOption');
    if (testOption) testOption.remove();
  }
});

// Initialize
loadState();
