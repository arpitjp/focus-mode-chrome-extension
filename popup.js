// DOM elements
const blockingToggle = document.getElementById('blockingToggle');
const toggleWrapper = document.getElementById('toggleWrapper');
const siteInput = document.getElementById('siteInput');
const addSiteBtn = document.getElementById('addSiteBtn');
const blockedSitesList = document.getElementById('blockedSitesList');
const blockedSitesSection = document.getElementById('blockedSitesSection');
const sitesDivider = document.getElementById('sitesDivider');
const durationContainer = document.getElementById('durationContainer');
const durationSelect = document.getElementById('durationSelect');
const customDuration = document.getElementById('customDuration');
const customMinutes = document.getElementById('customMinutes');
const timerText = document.getElementById('timerText');
const statsBar = document.getElementById('statsBar');
const statsText = document.getElementById('statsText');
const footer = document.getElementById('footer');

let countdownInterval = null;
let holdTimer = null;
let holdCompleted = false; // Flag to prevent click after successful hold
const HOLD_DURATION = 1000; // 1 second to turn off

// Stats click handlers - opens full stats page
statsBar.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

document.getElementById('statsHeaderBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('stats.html') });
});

// Hold-to-disable logic
function startHold() {
  if (!blockingToggle.checked) return; // Only for turning OFF
  
  toggleWrapper.classList.add('holding');
  holdTimer = setTimeout(() => {
    // Hold completed - turn off
    toggleWrapper.classList.remove('holding');
    holdCompleted = true; // Prevent the subsequent click from turning it back on
    blockingToggle.checked = false;
    updateToggleTitle(false);
    handleToggleChange();
  }, HOLD_DURATION);
}

function cancelHold() {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  toggleWrapper.classList.remove('holding');
}

function updateToggleTitle(isBlocking) {
  if (isBlocking) {
    toggleWrapper.title = 'Hold to disable blocking';
  } else {
    toggleWrapper.title = 'Click to enable blocking';
  }
}

// Handle toggle wrapper interactions
toggleWrapper.addEventListener('mousedown', (e) => {
  if (blockingToggle.checked) {
    // Blocking is ON - start hold timer to turn OFF
    e.preventDefault();
    startHold();
  }
  // If blocking is OFF, click handler will handle turn-ON
});

toggleWrapper.addEventListener('mouseup', cancelHold);
toggleWrapper.addEventListener('mouseleave', cancelHold);

toggleWrapper.addEventListener('click', (e) => {
  // If we just completed a hold to turn off, ignore this click
  if (holdCompleted) {
    holdCompleted = false;
    return;
  }
  
  if (!blockingToggle.checked) {
    // Blocking is OFF - turn ON immediately
    blockingToggle.checked = true;
    updateToggleTitle(true);
    handleToggleChange();
  }
  // If blocking is ON, the hold logic handles turn-OFF
});

toggleWrapper.addEventListener('touchstart', (e) => {
  if (blockingToggle.checked) {
    e.preventDefault();
    startHold();
  }
}, { passive: false });

toggleWrapper.addEventListener('touchend', (e) => {
  cancelHold();
  // If we just completed a hold to turn off, ignore this touch
  if (holdCompleted) {
    holdCompleted = false;
    return;
  }
  // Handle tap to turn ON for touch devices
  if (!blockingToggle.checked) {
    blockingToggle.checked = true;
    updateToggleTitle(true);
    handleToggleChange();
  }
});

toggleWrapper.addEventListener('touchcancel', cancelHold);

// Format time for display
function formatStatsTime(minutes) {
  if (minutes < 60) {
    return `${minutes} min`;
  } else if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  } else {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
}

// Calculate streak from stats
function calculateStreak(stats) {
  let streakCount = 0;
  const today = new Date();
  let checkDate = new Date(today);
  const todayKey = today.toISOString().split('T')[0];
  
  if (!stats.daily[todayKey]) {
    checkDate.setDate(checkDate.getDate() - 1);
  }
  
  while (true) {
    const dateKey = checkDate.toISOString().split('T')[0];
    if (stats.daily[dateKey] > 0) {
      streakCount++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streakCount;
}

// Display stats highlight with meaningful facts
async function displayStatsHighlight() {
  try {
    const result = await chrome.storage.sync.get(['stats', 'blockingEnabled', 'blockingStartTime']);
    const stats = result.stats || { daily: {}, totalMinutes: 0 };
    
    let currentSessionMinutes = 0;
    if (result.blockingEnabled && result.blockingStartTime) {
      currentSessionMinutes = Math.floor((Date.now() - result.blockingStartTime) / 60000);
    }
    
    const today = new Date().toISOString().split('T')[0];
    const todayMinutes = (stats.daily[today] || 0) + currentSessionMinutes;
    const totalMinutes = (stats.totalMinutes || 0) + currentSessionMinutes;
    
    let weekMinutes = 0;
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    for (const [date, mins] of Object.entries(stats.daily)) {
      if (new Date(date) >= weekAgo) {
        weekMinutes += mins;
      }
    }
    weekMinutes += currentSessionMinutes;
    
    const focusDays = Object.keys(stats.daily).filter(d => stats.daily[d] > 0).length;
    const avgDaily = focusDays > 0 ? Math.round(totalMinutes / focusDays) : 0;
    
    const highlights = [];
    
    // Stats highlights with celebration
    if (todayMinutes >= 60) {
      highlights.push({ text: `Focused for <strong>${formatStatsTime(todayMinutes)}</strong> today 🎉`, priority: 2 });
    } else if (todayMinutes > 0) {
      highlights.push({ text: `Focused for <strong>${todayMinutes} min</strong> today 🎉`, priority: 3 });
    }
    
    if (weekMinutes >= 60) {
      highlights.push({ text: `Focused for <strong>${formatStatsTime(weekMinutes)}</strong> this week 🎉`, priority: 3 });
    }
    
    if (totalMinutes >= 600) {
      highlights.push({ text: `Focused for <strong>${formatStatsTime(totalMinutes)}</strong> total 🎉`, priority: 3 });
    }
    
    if (focusDays >= 7) {
      highlights.push({ text: `Focused for <strong>${focusDays} days</strong> 🎉`, priority: 4 });
    }
    
    if (avgDaily >= 30 && focusDays >= 3) {
      highlights.push({ text: `Focused <strong>${formatStatsTime(avgDaily)}</strong> avg per day 🎉`, priority: 4 });
    }
    
    // Only show stats if user has completed at least one focus session AND blocking is OFF
    const hasCompletedSession = totalMinutes > 0 || Object.keys(stats.daily).length > 0;
    
    // Hide stats, blocked sites, and footer when session is active - keep focus on the task
    if (result.blockingEnabled) {
      statsBar.style.display = 'none';
      blockedSitesSection.style.display = 'none';
      sitesDivider.style.display = 'none';
      footer.style.display = 'none';
      return;
    } else {
      blockedSitesSection.style.display = 'block';
      sitesDivider.style.display = 'block';
      footer.style.display = 'flex';
    }
    
    if (highlights.length > 0) {
      // Show actual stats - use neutral language, no gamification
      highlights.sort((a, b) => a.priority - b.priority);
      const topPriority = highlights[0].priority;
      const topHighlights = highlights.filter(h => h.priority === topPriority);
      const chosen = topHighlights[Math.floor(Math.random() * topHighlights.length)];
      statsText.innerHTML = chosen.text;
      statsBar.style.display = 'flex';
    } else if (hasCompletedSession) {
      // Has some history but nothing notable to show
      statsText.innerHTML = 'View focus insights';
      statsBar.style.display = 'flex';
    } else {
      // No sessions yet - hide entirely (stats feel earned, not pushed)
      statsBar.style.display = 'none';
    }
  } catch (e) {
    statsBar.style.display = 'none';
  }
}
// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Single storage change listener for all updates
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync' && areaName !== 'local') return;
  
  // Handle blocking state changes
  if (changes.blockingEnabled !== undefined) {
    if (changes.blockingEnabled.newValue === false) {
      blockingToggle.checked = false;
      durationContainer.style.display = 'none';
      stopCountdown();
    } else {
      blockingToggle.checked = true;
    }
    // Update stats bar visibility based on blocking state
    displayStatsHighlight();
    // Refresh blocked sites list to update delete button state
    chrome.storage.sync.get(['blockedSites']).then(result => {
      displayBlockedSites(result.blockedSites ?? []);
    });
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
    updateToggleTitle(blockingEnabled);
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

  // Sort: protocols first, then wildcards, alphabetically within each group
  const sortedSites = [...sites].sort((a, b) => {
    const aIsProtocol = a.startsWith('http://') || a.startsWith('https://');
    const bIsProtocol = b.startsWith('http://') || b.startsWith('https://');
    
    if (aIsProtocol && !bIsProtocol) return -1;
    if (!aIsProtocol && bIsProtocol) return 1;
    return a.localeCompare(b);
  });

  sortedSites.forEach((site) => {
    const li = document.createElement('li');
    const siteName = document.createElement('span');
    siteName.className = 'site-name';
    if (site.startsWith('*')) {
      siteName.innerHTML = '<span class="wildcard">*</span>' + escapeHtml(site.slice(1));
    } else if (site.startsWith('https://')) {
      siteName.innerHTML = '<span class="protocol">https://</span>' + escapeHtml(site.slice(8));
    } else if (site.startsWith('http://')) {
      siteName.innerHTML = '<span class="protocol">http://</span>' + escapeHtml(site.slice(7));
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
      blockingDuration: null,
      blockingStartTime: null  // Clear to prevent orphaned timestamps
    });
    chrome.runtime.sendMessage({ action: 'updateBlocking', enabled }).catch(() => {});
  }
}

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

// Export blocked sites and stats to JSON file
document.getElementById('exportBtn').addEventListener('click', async () => {
  try {
    const result = await chrome.storage.sync.get(['blockedSites', 'stats']);
    const blockedSites = result.blockedSites || [];
    const stats = result.stats || { daily: {}, totalMinutes: 0 };
    
    if (blockedSites.length === 0 && stats.totalMinutes === 0) {
      alert('No data to export');
      return;
    }
    
    const data = {
      version: 2,
      exportedAt: new Date().toISOString(),
      blockedSites: blockedSites,
      stats: stats
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `focus-mode-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('Error exporting data');
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
    
    // Handle both v1 (sites only) and v2 (sites + stats) formats
    const hasBlockedSites = data.blockedSites && Array.isArray(data.blockedSites);
    const hasStats = data.stats && typeof data.stats === 'object';
    
    if (!hasBlockedSites && !hasStats) {
      alert('Invalid file format');
      return;
    }
    
    const result = await chrome.storage.sync.get(['blockedSites', 'stats']);
    let messages = [];
    
    // Import blocked sites
    if (hasBlockedSites) {
      const normalizedImported = data.blockedSites
        .filter(site => typeof site === 'string' && site.trim().length > 0)
        .map(site => normalizeSite(site))
        .filter(site => {
          // Validate: must have a domain part after prefix
          if (site.startsWith('*')) return site.length > 1;
          if (site.startsWith('http://')) return site.length > 7;
          if (site.startsWith('https://')) return site.length > 8;
          return site.length > 0;
        });
      
      const existingSites = result.blockedSites || [];
      const allSites = [...new Set([...existingSites, ...normalizedImported])];
      
      await saveToStorage({ blockedSites: allSites });
      displayBlockedSites(allSites);
      
      const newSiteCount = allSites.length - existingSites.length;
      messages.push(`${newSiteCount} new sites`);
    }
    
    // Import stats (merge daily data, keep higher values)
    if (hasStats && data.stats.daily) {
      const existingStats = result.stats || { daily: {}, totalMinutes: 0 };
      const mergedDaily = { ...existingStats.daily };
      let addedMinutes = 0;
      
      for (const [date, mins] of Object.entries(data.stats.daily)) {
        const existing = mergedDaily[date] || 0;
        if (mins > existing) {
          addedMinutes += (mins - existing);
          mergedDaily[date] = mins;
        }
      }
      
      const mergedStats = {
        daily: mergedDaily,
        totalMinutes: existingStats.totalMinutes + addedMinutes
      };
      
      await saveToStorage({ stats: mergedStats });
      
      if (addedMinutes > 0) {
        messages.push(`${Math.round(addedMinutes)} min of stats`);
      }
    }
    
    chrome.runtime.sendMessage({ action: 'updateRules' }).catch(() => {});
    displayStatsHighlight();
    
    if (messages.length > 0) {
      alert(`Imported: ${messages.join(', ')}`);
    } else {
      alert('No new data to import');
    }
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

// Support prompt modal logic
const PROMPT_THRESHOLD_MINUTES = 90;
const supportModal = document.getElementById('supportModal');
const rateBtn = document.getElementById('rateBtn');
const coffeeBtn = document.getElementById('coffeeBtn');
const remindLaterBtn = document.getElementById('remindLaterBtn');
const dontShowBtn = document.getElementById('dontShowBtn');

async function checkSupportPrompt() {
  try {
    const result = await chrome.storage.sync.get(['stats', 'supportPrompt']);
    const stats = result.stats || { totalMinutes: 0 };
    const prompt = result.supportPrompt || {};
    
    // Don't show if user dismissed permanently, already rated, or already supported
    if (prompt.dismissed || prompt.rated || prompt.supported) {
      return;
    }
    
    const totalMinutes = stats.totalMinutes || 0;
    const lastPromptAt = prompt.lastPromptAt || 0;
    const minutesSinceLastPrompt = totalMinutes - lastPromptAt;
    
    // Show prompt if:
    // 1. First time: total >= 90 minutes and never prompted before
    // 2. Remind later: 90 more minutes since last prompt
    const shouldShow = (lastPromptAt === 0 && totalMinutes >= PROMPT_THRESHOLD_MINUTES) ||
                       (lastPromptAt > 0 && minutesSinceLastPrompt >= PROMPT_THRESHOLD_MINUTES);
    
    if (shouldShow) {
      showSupportModal();
    }
  } catch (e) {
    // Non-critical
  }
}

function showSupportModal() {
  supportModal.style.display = 'flex';
}

function hideSupportModal() {
  supportModal.style.display = 'none';
}

// Rate button clicked - save BEFORE opening link
rateBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const result = await chrome.storage.sync.get(['supportPrompt', 'stats']);
    const stats = result.stats || { totalMinutes: 0 };
    await chrome.storage.sync.set({
      supportPrompt: {
        ...result.supportPrompt,
        rated: true,
        ratedAt: Date.now(),
        lastPromptAt: stats.totalMinutes || 0
      }
    });
  } catch (e) {}
  hideSupportModal();
  // Open link after saving
  window.open(rateBtn.href, '_blank');
});

// Coffee button clicked - save BEFORE opening link
coffeeBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const result = await chrome.storage.sync.get(['supportPrompt', 'stats']);
    const stats = result.stats || { totalMinutes: 0 };
    await chrome.storage.sync.set({
      supportPrompt: {
        ...result.supportPrompt,
        supported: true,
        supportedAt: Date.now(),
        lastPromptAt: stats.totalMinutes || 0
      }
    });
  } catch (e) {}
  hideSupportModal();
  // Open link after saving
  window.open(coffeeBtn.href, '_blank');
});

// Remind later
remindLaterBtn.addEventListener('click', async () => {
  try {
    const result = await chrome.storage.sync.get(['stats']);
    const stats = result.stats || { totalMinutes: 0 };
    await chrome.storage.sync.set({
      supportPrompt: {
        lastPromptAt: stats.totalMinutes || 0
      }
    });
  } catch (e) {}
  hideSupportModal();
});

// Don't show again
dontShowBtn.addEventListener('click', async () => {
  try {
    await chrome.storage.sync.set({
      supportPrompt: {
        dismissed: true,
        dismissedAt: Date.now()
      }
    });
  } catch (e) {}
  hideSupportModal();
});

// Close modal on overlay click
supportModal.addEventListener('click', (e) => {
  if (e.target === supportModal) {
    // Treat as remind later
    remindLaterBtn.click();
  }
});

// Initialize
loadState();
displayStatsHighlight();
checkSupportPrompt();