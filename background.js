// Starting rule ID for our blocking rules
const RULE_ID_START = 1;

// Track if we've initialized
let initialized = false;

// Session tracking constants
const MAX_SESSION_MINUTES = 1440; // 24 hours - sanity cap to catch bugs, not limit users
const SLEEP_GAP_MINUTES = 30; // If last heartbeat was > 30 min ago, assume sleep/shutdown

// Cache blocking state to avoid redundant storage reads on frequent tab updates
let cachedBlockingState = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5000; // Cache valid for 5 seconds

function invalidateBlockingCache() {
  cachedBlockingState = null;
  cacheTimestamp = 0;
}

async function getCachedBlockingState() {
  const now = Date.now();
  if (cachedBlockingState && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedBlockingState;
  }
  
  try {
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
    
    cachedBlockingState = {
      enabled: syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false,
      blockedSites: syncResult.blockedSites ?? localResult.blockedSites ?? []
    };
    cacheTimestamp = now;
  } catch {
    cachedBlockingState = { enabled: false, blockedSites: [] };
    cacheTimestamp = now;
  }
  
  return cachedBlockingState;
}

// Get today's date key for stats (LOCAL timezone, not UTC)
function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Validate minutes value - prevent NaN, negative, Infinity
function sanitizeMinutes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

// Mutex for stats writes to prevent race conditions
let statsWriteLock = false;
const statsWriteQueue = [];

async function acquireStatsLock() {
  if (!statsWriteLock) {
    statsWriteLock = true;
    return;
  }
  // Wait in queue
  await new Promise(resolve => statsWriteQueue.push(resolve));
}

function releaseStatsLock() {
  if (statsWriteQueue.length > 0) {
    const next = statsWriteQueue.shift();
    next();
  } else {
    statsWriteLock = false;
  }
}

// Add minutes to daily stats (with mutex protection)
async function addToDailyStats(minutes) {
  // Sanitize input
  const sanitized = sanitizeMinutes(minutes);
  if (sanitized <= 0) return;
  
  // Cap at max session to prevent runaway stats
  const cappedMinutes = Math.min(sanitized, MAX_SESSION_MINUTES);
  
  await acquireStatsLock();
  try {
    const result = await chrome.storage.sync.get(['stats']);
    const stats = result.stats || { daily: {}, totalMinutes: 0 };
    
    // Validate existing stats structure
    if (typeof stats.daily !== 'object' || stats.daily === null) {
      stats.daily = {};
    }
    if (typeof stats.totalMinutes !== 'number' || !Number.isFinite(stats.totalMinutes)) {
      stats.totalMinutes = 0;
    }
    
    const today = getTodayKey();
    
    const existingToday = sanitizeMinutes(stats.daily[today]);
    stats.daily[today] = existingToday + cappedMinutes;
    stats.totalMinutes = sanitizeMinutes(stats.totalMinutes) + cappedMinutes;
    
    // Track hourly patterns by date (for last 90 days filtering)
    if (!stats.hourlyByDate || typeof stats.hourlyByDate !== 'object') {
      stats.hourlyByDate = {};
    }
    const hour = new Date().getHours();
    if (!stats.hourlyByDate[today]) {
      stats.hourlyByDate[today] = {};
    }
    stats.hourlyByDate[today][hour] = sanitizeMinutes(stats.hourlyByDate[today][hour]) + cappedMinutes;
    
    // Prune old data (keep last 90 days to stay within storage limits)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffYear = cutoff.getFullYear();
    const cutoffMonth = String(cutoff.getMonth() + 1).padStart(2, '0');
    const cutoffDay = String(cutoff.getDate()).padStart(2, '0');
    const cutoffKeyStr = `${cutoffYear}-${cutoffMonth}-${cutoffDay}`;
    
    for (const key of Object.keys(stats.daily)) {
      if (key < cutoffKeyStr) delete stats.daily[key];
    }
    for (const key of Object.keys(stats.hourlyByDate)) {
      if (key < cutoffKeyStr) delete stats.hourlyByDate[key];
    }
    
    await chrome.storage.sync.set({ stats });
  } catch (e) {
    // Stats tracking is non-critical
  } finally {
    releaseStatsLock();
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

// Calculate valid session minutes (handles sleep/gaps and clock skew)
async function calculateSessionMinutes() {
  try {
    const syncResult = await chrome.storage.sync.get(['blockingStartTime']);
    const localResult = await chrome.storage.local.get(['lastHeartbeat', 'accumulatedMinutes']);
    
    const startTime = syncResult.blockingStartTime;
    const lastHeartbeat = localResult.lastHeartbeat || 0;
    const accumulated = sanitizeMinutes(localResult.accumulatedMinutes);
    
    if (!startTime || typeof startTime !== 'number') return accumulated;
    
    const now = Date.now();
    
    // Handle clock skew - if start time is in future, treat as 0
    if (startTime > now) return accumulated;
    
    const minutesSinceStart = Math.max(0, Math.floor((now - startTime) / 60000));
    
    // Check for sleep/restart gap
    if (lastHeartbeat > 0 && lastHeartbeat >= startTime) {
      const minutesSinceHeartbeat = Math.max(0, Math.floor((now - lastHeartbeat) / 60000));
      
      if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
        // Gap detected - only count time up to last heartbeat
        const validMinutes = Math.max(0, Math.floor((lastHeartbeat - startTime) / 60000));
        return accumulated + Math.min(validMinutes, MAX_SESSION_MINUTES - accumulated);
      }
    }
    
    // No gap - count full time (capped)
    return accumulated + Math.min(minutesSinceStart, MAX_SESSION_MINUTES - accumulated);
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
    const accumulated = sanitizeMinutes(localResult.accumulatedMinutes);
    
    if ((startTime && typeof startTime === 'number') || accumulated > 0) {
      let minutes = accumulated;
      
      if (startTime && typeof startTime === 'number') {
        const now = Date.now();
        
        // Handle clock skew - if start time is in future, skip this segment
        if (startTime <= now) {
          let sessionMinutes = Math.max(0, Math.floor((now - startTime) / 60000));
          
          // Check for sleep/restart gap - only count time up to last heartbeat
          if (lastHeartbeat > 0 && lastHeartbeat >= startTime && lastHeartbeat <= now) {
            const minutesSinceHeartbeat = Math.max(0, Math.floor((now - lastHeartbeat) / 60000));
            if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
              // Gap detected - only count time up to last heartbeat
              sessionMinutes = Math.max(0, Math.floor((lastHeartbeat - startTime) / 60000));
            }
          }
          
          minutes += Math.min(sessionMinutes, MAX_SESSION_MINUTES - accumulated);
        }
      }
      
      // Clear session data first to prevent data loss if addToDailyStats fails
      // and this function is called again
      await chrome.storage.sync.set({ blockingStartTime: null });
      await chrome.storage.local.set({ 
        lastHeartbeat: null, 
        accumulatedMinutes: 0,
        wasIdle: false 
      });
      
      // Now save stats (if this fails, at least session is cleared)
      if (minutes > 0) {
        await addToDailyStats(minutes);
      }
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
    const accumulated = sanitizeMinutes(localResult.accumulatedMinutes);
    
    if (startTime && typeof startTime === 'number' && startTime <= lastHeartbeat) {
      // Calculate minutes to accumulate (use last heartbeat as end point)
      const sessionMinutes = Math.max(0, Math.floor((lastHeartbeat - startTime) / 60000));
      const newAccumulated = accumulated + Math.min(sessionMinutes, MAX_SESSION_MINUTES - accumulated);
      
      // Clear start time but keep blocking enabled
      await chrome.storage.sync.set({ blockingStartTime: null });
      await chrome.storage.local.set({ 
        accumulatedMinutes: newAccumulated,
        wasIdle: true 
      });
    } else if (accumulated > 0) {
      // No valid start time but have accumulated - just mark as idle
      await chrome.storage.local.set({ wasIdle: true });
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
// Only pause on 'locked' (screen lock) - not on 'idle' because user may be working in other apps
async function handleIdleStateChange(state) {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled']);
    if (!result.blockingEnabled) return;
    
    if (state === 'locked') {
      // Screen locked - user definitely stepped away, pause session
      await pauseSession();
    } else if (state === 'active') {
      // User became active - resume session if it was paused
      await resumeSession();
    }
    // Note: 'idle' state is ignored - user might just be working in another app
  } catch (e) {}
}

// Mutex to prevent concurrent rule updates
let isUpdating = false;

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

// Batch add multiple tabs to avoid multiple storage writes
async function addMutedTabs(tabIds) {
  if (!tabIds || tabIds.length === 0) return;
  const muted = await getMutedTabs();
  for (const tabId of tabIds) {
    muted.add(tabId);
  }
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

// Check if offscreen document exists
async function hasOffscreenDocument() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

// Ensure offscreen document exists for audio playback
// This is required for playing sounds even when Chrome isn't focused
async function ensureOffscreen() {
  // Always verify the document actually exists (don't trust cached state)
  const exists = await hasOffscreenDocument();
  if (exists) return;
  
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play chime when focus session ends - even when Chrome is not in focus'
    });
  } catch (e) {
    // Document might already exist (race condition)
    if (!e.message?.includes('already exists')) {
      // Real error - log but don't crash
    }
  }
}

// Pre-create offscreen document on startup
ensureOffscreen();

// Play completion chime
async function playChime() {
  // Check if chime is muted (use local storage - more reliable, doesn't need sync)
  let isMuted = false;
  try {
    const result = await chrome.storage.local.get(['chimeMuted']);
    isMuted = result.chimeMuted === true;
  } catch (e) {
    // Storage check failed - default to not muted
  }
  
  if (isMuted) return;
  
  // Play the chime
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ action: 'offscreen_playChime' }).catch(() => {});
  } catch (e) {
    // Chime playback failed - non-critical
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
    
    const now = Date.now();
    const accumulated = sanitizeMinutes(localResult.accumulatedMinutes);
    
    if (!result.blockingEnabled) {
      // Blocking is off - save any orphaned session data before cleaning up
      // This handles the case where popup.js message to finalizeSession() failed
      if (result.blockingStartTime || accumulated > 0) {
        await finalizeSession(); // This saves stats then clears session data
      }
    } else if (result.blockingStartTime && typeof result.blockingStartTime === 'number') {
      const startTime = result.blockingStartTime;
      
      // Handle clock skew - if start time is in future, reset session
      if (startTime > now) {
        await chrome.storage.sync.set({ blockingStartTime: now });
        await chrome.storage.local.set({ 
          lastHeartbeat: now, 
          accumulatedMinutes: accumulated, // Keep any accumulated
          wasIdle: false 
        });
      } else {
        // Blocking is on with active session - check for gaps/caps
        const lastHeartbeat = (localResult.lastHeartbeat && localResult.lastHeartbeat >= startTime) 
          ? localResult.lastHeartbeat 
          : startTime;
        const minutesSinceHeartbeat = Math.max(0, Math.floor((now - lastHeartbeat) / 60000));
        const totalSessionMinutes = Math.max(0, Math.floor((now - startTime) / 60000));
        
        if (minutesSinceHeartbeat > SLEEP_GAP_MINUTES) {
          // Chrome restarted or woke from sleep - save time up to last heartbeat
          const validMinutes = Math.max(0, Math.floor((lastHeartbeat - startTime) / 60000));
          const cappedMinutes = Math.min(validMinutes, MAX_SESSION_MINUTES - accumulated);
          
          // Clear session first, then save stats
          await chrome.storage.sync.set({ blockingStartTime: now });
          await chrome.storage.local.set({ 
            lastHeartbeat: now, 
            accumulatedMinutes: 0,
            wasIdle: false 
          });
          
          if (cappedMinutes > 0 || accumulated > 0) {
            await addToDailyStats(accumulated + cappedMinutes);
          }
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
    } else if (result.blockingEnabled && accumulated > 0) {
      // Blocking enabled but no start time (paused/idle state from another device?)
      // Start fresh segment, keep accumulated
      await chrome.storage.sync.set({ blockingStartTime: now });
      await chrome.storage.local.set({ 
        lastHeartbeat: now,
        wasIdle: false 
      });
    }
  } catch (e) {}
  
  // Set up idle detection - we only care about 'locked' state (screen lock)
  // The threshold doesn't matter much since we ignore 'idle' state
  try {
    chrome.idle.setDetectionInterval(60); // 1 minute - just for detecting screen lock quickly
    chrome.idle.onStateChanged.addListener(handleIdleStateChange);
  } catch (e) {}
  
  await updateBlockingRules();
  await checkBlockingTimer();
  await reblockTabsAfterReload();
  
  // Restore timer if blocking is active with an end time
  // This ensures chime plays even after service worker restart
  try {
    const timerResult = await chrome.storage.sync.get(['blockingEnabled', 'blockingEndTime']);
    if (timerResult.blockingEnabled && timerResult.blockingEndTime && timerResult.blockingEndTime > Date.now()) {
      setTimerAlarm(timerResult.blockingEndTime);
    }
  } catch (e) {}
  
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
    // Timer ended - finalize session and disable blocking
    // Play chime here as fallback (in case setTimeout didn't fire due to service worker sleep)
    // The 3s debounce in offscreen.js prevents double-play if both setTimeout and alarm fire
    playChime();
    await finalizeSession();
    try {
      await chrome.storage.sync.set({ 
        blockingEnabled: false,
        blockingEndTime: null,
        blockingDuration: null
      });
      await updateBlockingRules(true);
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

// Check session sanity (catches bugs, not meant to limit users)
// With idle detection + heartbeat, this should rarely trigger
async function checkSessionCap() {
  try {
    const result = await chrome.storage.sync.get(['blockingEnabled', 'blockingStartTime']);
    const localResult = await chrome.storage.local.get(['accumulatedMinutes']);
    
    if (!result.blockingEnabled) return;
    
    const startTime = result.blockingStartTime;
    const accumulated = sanitizeMinutes(localResult.accumulatedMinutes);
    
    if (startTime && typeof startTime === 'number' && startTime <= Date.now()) {
      const sessionMinutes = Math.max(0, Math.floor((Date.now() - startTime) / 60000));
      const totalMinutes = accumulated + sessionMinutes;
      
      // 24 hour sanity cap - if reached, something's wrong (idle detection should have kicked in)
      if (totalMinutes >= MAX_SESSION_MINUTES) {
        // Save what we have and start fresh segment
        await finalizeSession();
        await chrome.storage.sync.set({ blockingStartTime: Date.now() });
        await chrome.storage.local.set({ 
          lastHeartbeat: Date.now(),
          accumulatedMinutes: 0,
          wasIdle: false 
        });
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
      // Note: chime is played via setTimeout in setTimerAlarm (not here to avoid duplicates)
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
    // Collect all tabs to mute, then batch write to storage
    const tabsToMute = [];
    
    for (const tab of tabs) {
      if (!tab.url || !tab.id) continue;
      
      // Skip chrome:// and extension pages
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      
      // Check if tab URL matches any blocked site
      const urlLower = tab.url.toLowerCase();
      const isBlocked = blockedSites.some(site => matchesSite(urlLower, site));
      
      if (isBlocked) {
        // Mute the tab immediately to stop audio
        chrome.tabs.update(tab.id, { muted: true }).catch(() => {});
        tabsToMute.push(tab.id);
        
        // Try to inject blocker script
        const injected = await injectBlockerScript(tab.id);
        
        // If script injection failed, reload the tab to trigger declarativeNetRequest redirect
        if (!injected) {
          chrome.tabs.reload(tab.id).catch(() => {});
        }
      }
    }
    
    // Batch write muted tabs to storage (single write instead of per-tab)
    if (tabsToMute.length > 0) {
      await addMutedTabs(tabsToMute);
    }
  } catch (e) {
    // Tab sync failed - non-critical
  }
}

// Listen for storage changes to update rules
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' || areaName === 'local') {
    if (changes.blockingEnabled || changes.blockedSites) {
      invalidateBlockingCache(); // Clear cache on state changes
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
    // Use cached state to avoid redundant storage reads on every tab update
    const { enabled, blockedSites } = await getCachedBlockingState();
    
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
