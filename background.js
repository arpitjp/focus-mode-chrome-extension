// Starting rule ID for our blocking rules
const RULE_ID_START = 1;

// Track if we've initialized
let initialized = false;

// Session tracking constants
const MAX_SESSION_MINUTES = 480; // 8 hours max per session (even for infinite)
const IDLE_THRESHOLD_SECONDS = 300; // 5 minutes idle = pause session
const SLEEP_GAP_MINUTES = 10; // If last heartbeat was > 10 min ago, assume sleep/restart

// Get today's date key for stats
function getTodayKey() {
  return new Date().toISOString().split('T')[0];
}

// Add minutes to daily stats
async function addToDailyStats(minutes) {
  if (minutes <= 0) return;
  
  // Cap at max session to prevent runaway stats
  const cappedMinutes = Math.min(minutes, MAX_SESSION_MINUTES);
  
  try {
    const result = await chrome.storage.sync.get(['stats']);
    const stats = result.stats || { daily: {}, totalMinutes: 0 };
    const today = getTodayKey();
    
    stats.daily[today] = (stats.daily[today] || 0) + cappedMinutes;
    stats.totalMinutes = (stats.totalMinutes || 0) + cappedMinutes;
    
    // Prune old daily data (keep last 90 days to stay within storage limits)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = cutoff.toISOString().split('T')[0];
    for (const key of Object.keys(stats.daily)) {
      if (key < cutoffKey) delete stats.daily[key];
    }
    
    await chrome.storage.sync.set({ stats });
  } catch (e) {
    // Stats tracking is non-critical
  }
}

// Update heartbeat - called periodically to track last active time
async function updateHeartbeat() {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled']);
    if (result.blockingEnabled) {
      await chrome.storage.local.set({ lastHeartbeat: Date.now() });
    }
  } catch (e) {}
}

// Calculate valid session minutes (handles sleep/gaps)
async function calculateSessionMinutes() {
  try {
    const syncResult = await chrome.storage.sync.get(['blockingStartTime']);
    const localResult = await chrome.storage.local.get(['lastHeartbeat', 'accumulatedMinutes']);
    
    const startTime = syncResult.blockingStartTime;
    const lastHeartbeat = localResult.lastHeartbeat || 0;
    const accumulated = localResult.accumulatedMinutes || 0;
    
    if (!startTime) return accumulated;
    
    const now = Date.now();
    const minutesSinceStart = Math.floor((now - startTime) / 60000);
    
    // Check for sleep/restart gap
    if (lastHeartbeat > 0) {
      const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 60000);
      
      if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
        // Gap detected - only count time up to last heartbeat
        const validMinutes = Math.floor((lastHeartbeat - startTime) / 60000);
        return accumulated + Math.max(0, Math.min(validMinutes, MAX_SESSION_MINUTES));
      }
    }
    
    // No gap - count full time (capped)
    return accumulated + Math.min(minutesSinceStart, MAX_SESSION_MINUTES);
  } catch (e) {
    return 0;
  }
}

// Finalize current session and add to stats
async function finalizeSession() {
  try {
    const result = await chrome.storage.sync.get(['blockingStartTime']);
    const localResult = await chrome.storage.local.get(['lastHeartbeat', 'accumulatedMinutes']);
    
    const startTime = result.blockingStartTime;
    const lastHeartbeat = localResult.lastHeartbeat || 0;
    const accumulated = localResult.accumulatedMinutes || 0;
    
    if (startTime || accumulated > 0) {
      let minutes = accumulated;
      
      if (startTime) {
        const now = Date.now();
        let sessionMinutes = Math.floor((now - startTime) / 60000);
        
        // Check for sleep/restart gap - only count time up to last heartbeat
        if (lastHeartbeat > 0) {
          const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 60000);
          if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
            // Gap detected - only count time up to last heartbeat
            sessionMinutes = Math.floor((lastHeartbeat - startTime) / 60000);
          }
        }
        
        minutes += Math.max(0, Math.min(sessionMinutes, MAX_SESSION_MINUTES - accumulated));
      }
      
      await addToDailyStats(minutes);
      await chrome.storage.sync.set({ blockingStartTime: null });
      await chrome.storage.local.set({ 
        lastHeartbeat: null, 
        accumulatedMinutes: 0,
        wasIdle: false 
      });
    }
  } catch (e) {}
}

// Pause session (on idle) - save accumulated time without ending blocking
async function pauseSession() {
  try {
    const result = await chrome.storage.sync.get(['blockingStartTime', 'blockingEnabled']);
    const localResult = await chrome.storage.local.get(['lastHeartbeat', 'accumulatedMinutes', 'wasIdle']);
    
    if (!result.blockingEnabled || localResult.wasIdle) return;
    
    const startTime = result.blockingStartTime;
    const lastHeartbeat = localResult.lastHeartbeat || Date.now();
    const accumulated = localResult.accumulatedMinutes || 0;
    
    if (startTime) {
      // Calculate minutes to accumulate (use last heartbeat as end point)
      const sessionMinutes = Math.floor((lastHeartbeat - startTime) / 60000);
      const newAccumulated = accumulated + Math.max(0, Math.min(sessionMinutes, MAX_SESSION_MINUTES - accumulated));
      
      // Clear start time but keep blocking enabled
      await chrome.storage.sync.set({ blockingStartTime: null });
      await chrome.storage.local.set({ 
        accumulatedMinutes: newAccumulated,
        wasIdle: true 
      });
    }
  } catch (e) {}
}

// Resume session (on active after idle)
async function resumeSession() {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled']);
    const localResult = await chrome.storage.local.get(['wasIdle']);
    
    if (!result.blockingEnabled || !localResult.wasIdle) return;
    
    // Start new segment
    await chrome.storage.sync.set({ blockingStartTime: Date.now() });
    await chrome.storage.local.set({ 
      wasIdle: false,
      lastHeartbeat: Date.now()
    });
  } catch (e) {}
}

// Start a new session
async function startSession() {
  try {
    // Finalize any existing session first (handles mid-session restarts)
    await finalizeSession();
    const now = Date.now();
    await chrome.storage.sync.set({ blockingStartTime: now });
    await chrome.storage.local.set({ 
      lastHeartbeat: now,
      accumulatedMinutes: 0,
      wasIdle: false
    });
  } catch (e) {}
}

// Handle idle state changes
async function handleIdleStateChange(state) {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled']);
    if (!result.blockingEnabled) return;
    
    if (state === 'idle' || state === 'locked') {
      // User went idle - pause session to stop counting
      await pauseSession();
    } else if (state === 'active') {
      // User became active - resume session
      await resumeSession();
    }
  } catch (e) {}
}

// Mutex to prevent concurrent rule updates
let isUpdating = false;

// Keep offscreen document ready
let offscreenReady = false;

// Timer references - track all to prevent memory leaks
let timerTimeout = null;
let chimeTimeout = null;

// Track tabs we've muted (stored in chrome.storage.local to persist across service worker restarts)
async function getMutedTabs() {
  try {
    const result = await chrome.storage.local.get(['mutedByExtension']);
    return new Set(result.mutedByExtension || []);
  } catch {
    return new Set();
  }
}

async function addMutedTab(tabId) {
  const muted = await getMutedTabs();
  muted.add(tabId);
  await chrome.storage.local.set({ mutedByExtension: [...muted] }).catch(() => {});
}

async function removeMutedTab(tabId) {
  const muted = await getMutedTabs();
  muted.delete(tabId);
  await chrome.storage.local.set({ mutedByExtension: [...muted] }).catch(() => {});
}

async function clearAllMutedTabs() {
  await chrome.storage.local.set({ mutedByExtension: [] }).catch(() => {});
}

async function ensureOffscreen() {
  if (offscreenReady) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play chime when focus session ends'
    });
    offscreenReady = true;
  } catch (e) {
    if (e.message?.includes('already exists')) {
      offscreenReady = true;
    }
  }
}

// Pre-create offscreen document on startup
ensureOffscreen();

// Play completion chime
async function playChime() {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ action: 'offscreen_playChime' }).catch(() => {});
  } catch (e) {
    // Silently fail - chime is non-critical
  }
}

// Update the extension badge to show on/off status
async function updateBadge(enabled) {
  try {
    if (enabled) {
      await chrome.action.setBadgeText({ text: 'ON' });
      await chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    } else {
      await chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // Badge update is non-critical
  }
}

// Clear all timer references
function clearAllTimers() {
  if (timerTimeout) {
    clearTimeout(timerTimeout);
    timerTimeout = null;
  }
  if (chimeTimeout) {
    clearTimeout(chimeTimeout);
    chimeTimeout = null;
  }
  chrome.alarms.clear('focusTimerEnd').catch(() => {});
}

// Initialize once
async function initialize() {
  if (initialized) return;
  initialized = true;
  
  // Clear all existing rules first to ensure clean state (removes any old redirect rules)
  try {
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    if (existingRules.length > 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingRules.map(r => r.id)
      });
    }
  } catch (e) {}
  
  // Handle Chrome restart / sleep wake scenario
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled', 'blockingStartTime']);
    const localResult = await chrome.storage.local.get(['lastHeartbeat', 'accumulatedMinutes']);
    
    if (!result.blockingEnabled) {
      // Blocking is off - clean up any orphaned data
      if (result.blockingStartTime || localResult.accumulatedMinutes) {
        await chrome.storage.sync.set({ blockingStartTime: null });
        await chrome.storage.local.set({ 
          lastHeartbeat: null, 
          accumulatedMinutes: 0,
          wasIdle: false 
        });
      }
    } else if (result.blockingStartTime) {
      // Blocking is on with active session - check for gaps/caps
      const now = Date.now();
      const lastHeartbeat = localResult.lastHeartbeat || result.blockingStartTime;
      const minutesSinceHeartbeat = Math.floor((now - lastHeartbeat) / 60000);
      const totalSessionMinutes = Math.floor((now - result.blockingStartTime) / 60000);
      const accumulated = localResult.accumulatedMinutes || 0;
      
      if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
        // Chrome restarted or woke from sleep - save time up to last heartbeat
        const validMinutes = Math.floor((lastHeartbeat - result.blockingStartTime) / 60000);
        const cappedMinutes = Math.min(validMinutes, MAX_SESSION_MINUTES);
        
        if (cappedMinutes > 0 || accumulated > 0) {
          await addToDailyStats(accumulated + cappedMinutes);
        }
        
        // Start fresh segment
        await chrome.storage.sync.set({ blockingStartTime: now });
        await chrome.storage.local.set({ 
          lastHeartbeat: now, 
          accumulatedMinutes: 0,
          wasIdle: false 
        });
      } else if (totalSessionMinutes + accumulated >= MAX_SESSION_MINUTES) {
        // Session exceeded max - finalize and start fresh
        await finalizeSession();
        await chrome.storage.sync.set({ blockingStartTime: now });
        await chrome.storage.local.set({ 
          lastHeartbeat: now, 
          accumulatedMinutes: 0,
          wasIdle: false 
        });
      } else {
        // Normal resume - just update heartbeat
        await chrome.storage.local.set({ lastHeartbeat: now });
      }
    }
  } catch (e) {}
  
  // Set up idle detection (5 min threshold)
  try {
    chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
    chrome.idle.onStateChanged.addListener(handleIdleStateChange);
  } catch (e) {}
  
  await updateBlockingRules();
  await checkBlockingTimer();
  await reblockTabsAfterReload();
  
  // Set up alarms for periodic checks
  chrome.alarms.create('checkBlockingTimer', { periodInMinutes: 1 });
  chrome.alarms.create('heartbeat', { periodInMinutes: 1 }); // Heartbeat every minute
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkBlockingTimer') {
    await checkBlockingTimer();
    await checkSessionCap();
  }
  if (alarm.name === 'heartbeat') {
    await updateHeartbeat();
  }
  if (alarm.name === 'focusTimerEnd') {
    // Timer ended - finalize session, disable blocking and play chime
    await finalizeSession();
    try {
      await chrome.storage.sync.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      });
      await updateBlockingRules(true);
      playChime();
    } catch (e) {
      // Fallback to local storage
      await chrome.storage.local.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      });
      await updateBlockingRules(true);
    }
  }
});

// Check if session has exceeded max cap (for infinite sessions)
async function checkSessionCap() {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled', 'blockingStartTime', 'blockingDuration']);
    const localResult = await chrome.storage.local.get(['accumulatedMinutes']);
    
    // Only check infinite sessions (timed sessions have their own end)
    if (!result.blockingEnabled || result.blockingDuration !== 'infinite') return;
    
    const startTime = result.blockingStartTime;
    const accumulated = localResult.accumulatedMinutes || 0;
    
    if (startTime) {
      const sessionMinutes = Math.floor((Date.now() - startTime) / 60000);
      const totalMinutes = accumulated + sessionMinutes;
      
      if (totalMinutes >= MAX_SESSION_MINUTES) {
        // Max reached - finalize, play chime, but keep blocking enabled
        // User needs to manually restart or turn off
        await finalizeSession();
        
        // Start fresh session segment (blocking stays on)
        await chrome.storage.sync.set({ blockingStartTime: Date.now() });
        await chrome.storage.local.set({ 
          lastHeartbeat: Date.now(),
          accumulatedMinutes: 0,
          wasIdle: false 
        });
        
        // Notify user they hit the cap
        playChime();
      }
    }
  } catch (e) {}
}

// Set precise timer using setTimeout (more accurate than alarms for short durations)
function setTimerAlarm(endTime) {
  clearAllTimers();
  
  if (!endTime) return;
  
  const actualDelayMs = endTime - Date.now();
  if (actualDelayMs <= 0) return;
  
  // Play chime 2 seconds early (separate from blocking end)
  const chimeDelayMs = Math.max(0, actualDelayMs - 2000);
  chimeTimeout = setTimeout(() => {
    playChime();
  }, chimeDelayMs);
  
  // End blocking at actual time
  timerTimeout = setTimeout(async () => {
    await finalizeSession();
    try {
      await chrome.storage.sync.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      });
    } catch (e) {
      // Fallback
      await chrome.storage.local.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      }).catch(() => {});
    }
    await updateBlockingRules(true);
  }, actualDelayMs);
  
  // Also set alarm as backup (in case service worker sleeps)
  const delayMinutes = Math.max(actualDelayMs / 60000, 0.01);
  chrome.alarms.create('focusTimerEnd', { delayInMinutes: delayMinutes });
}

// Re-block tabs after extension reload
async function reblockTabsAfterReload() {
  try {
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
    
    const enabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
    const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
    
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      
      if (!enabled || blockedSites.length === 0) continue;
      
      const urlLower = tab.url.toLowerCase();
      const isBlocked = blockedSites.some(site => matchesSite(urlLower, site));
      
      if (isBlocked) {
        await injectBlockerScript(tab.id);
      }
    }
  } catch (e) {
    // Non-critical - tabs will be blocked on next navigation
  }
}

// Helper function to check if URL matches a blocked site
// *domain → matches anywhere (all subdomains)
// https://domain → exact domain match only (NOT subdomains)
function matchesSite(urlLower, site) {
  if (site.startsWith('*')) {
    // Wildcard: match anywhere in URL (includes subdomains like music.youtube.com)
    return urlLower.includes(site.substring(1).toLowerCase());
  } else if (site.startsWith('http://') || site.startsWith('https://')) {
    // Full URL: exact domain match only, NOT subdomains
    try {
      const ruleUrl = new URL(site.toLowerCase());
      const pageUrl = new URL(urlLower);
      const ruleDomain = ruleUrl.hostname.replace(/^www\./, '');
      const pageDomain = pageUrl.hostname.replace(/^www\./, '');
      return ruleDomain === pageDomain;
    } catch {
      return urlLower.startsWith(site.toLowerCase());
    }
  } else {
    return urlLower.includes(site.toLowerCase());
  }
}

// Check for expired blocking timer
async function checkBlockingTimer() {
  try {
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockingEndTime']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockingEndTime']);
    
    const blockingEnabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
    const blockingEndTime = syncResult.blockingEndTime ?? localResult.blockingEndTime ?? null;
    
    if (blockingEnabled && blockingEndTime && Date.now() >= blockingEndTime) {
      await finalizeSession();
      await chrome.storage.sync.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      }).catch(() => {});
      await updateBlockingRules(true);
      playChime();
    }
  } catch (e) {
    // Timer check failed - will retry on next alarm
  }
}

// Initialize when script loads
initialize();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'test') {
    sendResponse({ success: true, message: 'Background script is running' });
    return true;
  }
  
  if (message.action === 'openPopup') {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'playChime') {
    playChime();
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === 'updateBlocking' || message.action === 'updateRules') {
    // Handle blocking state changes with stats tracking
    if (message.action === 'updateBlocking') {
      (async () => {
        if (message.enabled) {
          await startSession();
          if (message.endTime) {
            setTimerAlarm(message.endTime);
          }
        } else {
          await finalizeSession();
          clearAllTimers();
        }
        
        await updateBlockingRules(true);
        
        // Broadcast to all tabs
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              chrome.tabs.sendMessage(tab.id, { 
                action: 'timerUpdated', 
                endTime: message.endTime,
                enabled: message.enabled
              }).catch(() => {});
            }
          }
        });
      })();
    } else {
      // Just updateRules
      setTimeout(async () => {
        await updateBlockingRules(true);
      }, 100);
    }
  }
  
  sendResponse({ success: true });
  return true;
});

// Update blocking rules based on storage state
async function updateBlockingRules(syncTabs = false) {
  if (isUpdating) return;
  isUpdating = true;
  
  try {
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
    
    const enabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
    const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
    
    await updateBadge(enabled);

    // Clear ALL declarativeNetRequest rules - we use content script overlay only
    // This avoids chrome-extension:// URLs and keeps original URLs intact
    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      if (existingRules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existingRules.map(r => r.id)
        });
      }
    } catch (e) {}
    
    if (syncTabs) {
      await syncOpenTabs(enabled, blockedSites);
    }
    
  } catch (e) {
    // Rule update failed - will retry on next trigger
  } finally {
    isUpdating = false;
  }
}

// Sync open tabs with blocking rules
async function syncOpenTabs(blockingEnabled, blockedSites) {
  try {
    const tabs = await chrome.tabs.query({});
    
    // If blocking is disabled, unmute all tabs we muted and clear tracking
    if (!blockingEnabled || blockedSites.length === 0) {
      const mutedTabs = await getMutedTabs();
      for (const tab of tabs) {
        if (!tab.url || !tab.id) continue;
        
        // Unmute if we muted it
        if (mutedTabs.has(tab.id)) {
          chrome.tabs.update(tab.id, { muted: false }).catch(() => {});
        }
      }
      // Clear all muted tabs tracking at once
      await clearAllMutedTabs();
      return;
    }
    
    // Blocking is enabled - mute and block matching tabs
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      
      // Skip chrome:// and extension pages
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      
      // Check if tab URL matches any blocked site
      const urlLower = tab.url.toLowerCase();
      const isBlocked = blockedSites.some(site => matchesSite(urlLower, site));
      
      if (isBlocked) {
        // Mute the tab immediately to stop audio (track that we muted it)
        chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
        await addMutedTab(tab.id);
        
        // Try to inject blocker script
        const injected = await injectBlockerScript(tab.id);
        
        // If script injection failed, reload the tab to trigger declarativeNetRequest redirect
        if (!injected) {
          chrome.tabs.reload(tab.id).catch(() => {});
        }
      }
    }
  } catch (e) {
    // Tab sync failed - non-critical
  }
}

// Listen for storage changes to update rules
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' || areaName === 'local') {
    if (changes.blockingEnabled || changes.blockedSites) {
      updateBlockingRules(true);
    }
  }
});

// Clean up muted tabs tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  removeMutedTab(tabId);
});

// Block websites using tabs.onUpdated listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' && !changeInfo.url) return;
  
  const url = tab.url || changeInfo.url;
  if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;
  
  try {
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
    
    const enabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
    const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
    
    if (!enabled || blockedSites.length === 0) return;
    
    const urlLower = url.toLowerCase();
    const isBlocked = blockedSites.some(site => matchesSite(urlLower, site));
    
    if (isBlocked) {
      // Re-mute tab on reload (mute state resets on page load)
      chrome.tabs.update(tabId, { muted: true }).catch(() => {});
      await addMutedTab(tabId);
      await injectBlockerScript(tabId);
    }
  } catch (e) {
    // Tab update handling failed - non-critical
  }
});

// Inject the blocker content script into a tab
// Returns true if injection succeeded, false otherwise
async function injectBlockerScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-blocker.js']
    });
    return true;
  } catch (e) {
    // Script injection failed - likely invalid tab or restricted page
    return false;
  }
}
