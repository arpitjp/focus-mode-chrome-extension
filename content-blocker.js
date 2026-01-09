// Content script that overlays a "blocked" message on blocked sites
// This approach keeps the tab on the original URL, so it survives extension reloads

(function() {
  // Check if already initialized to prevent multiple instances
  if (window.__focusBlockerInitialized) return;
  window.__focusBlockerInitialized = true;

  // Store references for cleanup
  let timerInterval = null;
  let storageListener = null;
  let messageListener = null;
  let mediaObserver = null;
  let mediaKillerInterval = null;
  let currentEndTime = null;

  // Stop all media on the page
  function killAllMedia() {
    // Stop all video elements
    const videos = document.getElementsByTagName('video');
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      video.pause();
      video.muted = true;
      video.src = '';
      video.srcObject = null;
    }
    
    // Stop all audio elements
    const audios = document.getElementsByTagName('audio');
    for (let i = 0; i < audios.length; i++) {
      const audio = audios[i];
      audio.pause();
      audio.muted = true;
      audio.src = '';
      audio.srcObject = null;
    }
    
    // Remove all iframes (YouTube embeds, etc.)
    const iframes = document.getElementsByTagName('iframe');
    for (let i = 0; i < iframes.length; i++) {
      iframes[i].src = 'about:blank';
    }
  }

  // Cleanup function to prevent memory leaks
  function cleanup() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (mediaKillerInterval) {
      clearInterval(mediaKillerInterval);
      mediaKillerInterval = null;
    }
    if (mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
    if (storageListener) {
      chrome.storage.onChanged.removeListener(storageListener);
      storageListener = null;
    }
    if (messageListener) {
      chrome.runtime.onMessage.removeListener(messageListener);
      messageListener = null;
    }
    window.__focusBlockerInitialized = false;
  }

  function removeOverlay() {
    const overlay = document.getElementById('focus-blocker-overlay');
    if (overlay) {
      cleanup();
      overlay.remove();
      document.body.style.overflow = '';
    }
  }

  // Storage change listener
  storageListener = (changes, areaName) => {
    if (areaName !== 'sync' && areaName !== 'local') return;
    
    if (changes.blockingEnabled?.newValue === false) {
      removeOverlay();
      return;
    }
    if (changes.blockingEndTime !== undefined) {
      updateTimerDisplay(changes.blockingEndTime.newValue);
    }
  };
  chrome.storage.onChanged.addListener(storageListener);
  
  // Message listener for direct updates from background
  messageListener = (message) => {
    if (message.action === 'timerUpdated') {
      if (message.enabled === false) {
        removeOverlay();
      } else {
        updateTimerDisplay(message.endTime);
      }
    }
  };
  chrome.runtime.onMessage.addListener(messageListener);
  
  // Update timer display
  function updateTimerDisplay(endTime) {
    currentEndTime = endTime;
    const timerValue = document.getElementById('focus-blocker-timer-value');
    if (!timerValue) return;
    
    if (!endTime) {
      timerValue.textContent = '∞';
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    }
    
    // Update immediately then start interval if not already running
    updateTimerText(timerValue, endTime);
    
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        if (currentEndTime) {
          updateTimerText(timerValue, currentEndTime);
        }
      }, 1000);
    }
  }
  
  function updateTimerText(timerValue, endTime) {
    const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
    
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const secs = remaining % 60;
      
      if (hours > 0) {
        timerValue.textContent = `${hours}h ${minutes}m ${secs}s`;
      } else if (minutes > 0) {
        timerValue.textContent = `${minutes}m ${secs}s`;
      } else {
        timerValue.textContent = `${secs}s`;
      }
    } else {
      removeOverlay();
    }
  }

  // Get blocking info from storage
  chrome.storage.sync.get(['blockingEnabled', 'blockedSites', 'blockingEndTime'], (syncResult) => {
    chrome.storage.local.get(['blockingEnabled', 'blockedSites', 'blockingEndTime'], (localResult) => {
      const enabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
      const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];
      const endTime = syncResult.blockingEndTime ?? localResult.blockingEndTime ?? null;

      if (!enabled || blockedSites.length === 0) {
        cleanup();
        return;
      }

      const currentUrl = window.location.href.toLowerCase();
      
      // Check if current site is blocked
      const matchedSite = blockedSites.find(site => {
        if (site.startsWith('*')) {
          return currentUrl.includes(site.substring(1).toLowerCase());
        } else if (site.startsWith('http://') || site.startsWith('https://')) {
          return currentUrl.startsWith(site.toLowerCase());
        } else {
          return currentUrl.includes(site.toLowerCase());
        }
      });

      if (matchedSite) {
        const displaySite = matchedSite.startsWith('*') ? matchedSite.substring(1) : matchedSite;
        showBlockedOverlay(displaySite, endTime);
      } else {
        cleanup();
      }
    });
  });

  function showBlockedOverlay(site, endTime) {
    if (document.getElementById('focus-blocker-overlay')) return;

    // Kill all media immediately
    killAllMedia();
    
    // Keep killing media periodically (reduced frequency)
    mediaKillerInterval = setInterval(killAllMedia, 2000);
    
    // Watch for new media elements - only watch body, not entire document
    mediaObserver = new MutationObserver(() => killAllMedia());
    if (document.body) {
      mediaObserver.observe(document.body, { childList: true, subtree: true });
    }

    // Create overlay
    const overlay = document.createElement('div');
    overlay.id = 'focus-blocker-overlay';
    overlay.innerHTML = `
      <style>
        #focus-blocker-overlay {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          background: #0c0c14 !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          overflow: hidden !important;
        }
        #focus-blocker-overlay::before {
          content: '' !important;
          position: absolute !important;
          top: -50% !important;
          left: -50% !important;
          width: 200% !important;
          height: 200% !important;
          background: 
            radial-gradient(ellipse at 20% 30%, rgba(99, 102, 241, 0.15) 0%, transparent 40%),
            radial-gradient(ellipse at 80% 70%, rgba(139, 92, 246, 0.1) 0%, transparent 40%),
            radial-gradient(ellipse at 50% 50%, rgba(59, 130, 246, 0.05) 0%, transparent 60%) !important;
          pointer-events: none !important;
        }
        #focus-blocker-overlay * {
          box-sizing: border-box !important;
        }
        .focus-blocker-container {
          text-align: center !important;
          padding: 60px !important;
          max-width: 640px !important;
        }
        .focus-blocker-header {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 24px !important;
          margin-bottom: 32px !important;
        }
        .focus-blocker-icon {
          width: 64px !important;
          height: 64px !important;
          flex-shrink: 0 !important;
        }
        .focus-blocker-icon img {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
        }
        .focus-blocker-title {
          font-size: 32px !important;
          font-weight: 700 !important;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          background-clip: text !important;
        }
        .focus-blocker-subtitle {
          font-size: 14px !important;
          color: #6b7280 !important;
          margin-bottom: 56px !important;
          line-height: 1.5 !important;
          letter-spacing: 0.3px !important;
          font-weight: 400 !important;
          opacity: 0.85 !important;
        }
        .focus-blocker-info {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 24px !important;
          margin-bottom: 64px !important;
          flex-wrap: wrap !important;
        }
        .focus-blocker-site {
          display: inline-block !important;
          background: rgba(102, 126, 234, 0.12) !important;
          border: 1px solid rgba(102, 126, 234, 0.2) !important;
          padding: 14px 32px !important;
          border-radius: 24px !important;
          font-size: 15px !important;
          color: #667eea !important;
          font-weight: 500 !important;
        }
        .focus-blocker-timer {
          display: inline-flex !important;
          align-items: center !important;
          gap: 14px !important;
          background: rgba(102, 126, 234, 0.08) !important;
          border: 1px solid rgba(102, 126, 234, 0.15) !important;
          border-radius: 24px !important;
          padding: 14px 32px !important;
        }
        .focus-blocker-timer-label {
          font-size: 11px !important;
          color: #718096 !important;
          text-transform: uppercase !important;
          letter-spacing: 1.2px !important;
        }
        .focus-blocker-timer-value {
          font-size: 20px !important;
          font-weight: 700 !important;
          color: #667eea !important;
        }
        .focus-blocker-footer {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          gap: 24px !important;
        }
        .focus-blocker-branding {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          color: #4a5568 !important;
          font-size: 12px !important;
          cursor: pointer !important;
          transition: color 0.2s ease !important;
        }
        .focus-blocker-branding:hover {
          color: #667eea !important;
        }
        .focus-blocker-branding-icon {
          width: 18px !important;
          height: 18px !important;
        }
        .focus-blocker-branding-icon img {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
        }
        .focus-blocker-divider {
          width: 1px !important;
          height: 16px !important;
          background: rgba(255,255,255,0.1) !important;
        }
        .focus-blocker-coffee {
          display: inline-flex !important;
          align-items: center !important;
          gap: 6px !important;
          color: #4a5568 !important;
          font-size: 12px !important;
          text-decoration: none !important;
          transition: color 0.15s ease !important;
          animation: focus-nudge 0.5s ease-in-out 0.6s !important;
        }
        .focus-blocker-coffee:hover {
          color: #f5c842 !important;
        }
        .focus-blocker-coffee svg {
          width: 14px !important;
          height: 14px !important;
        }
        @keyframes focus-nudge {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(2px); }
          75% { transform: translateX(-2px); }
        }
      </style>
      <div class="focus-blocker-container">
        <div class="focus-blocker-header">
          <div class="focus-blocker-icon">
            <img src="${chrome.runtime.getURL('icon128.png')}" alt="Focus Mode">
          </div>
          <h1 class="focus-blocker-title">Stay Focused!</h1>
        </div>
        <p class="focus-blocker-subtitle">This website has been blocked to help you stay productive.</p>
        <div class="focus-blocker-info">
          <div class="focus-blocker-site">${escapeHtml(site)}</div>
          <div class="focus-blocker-timer" id="focus-blocker-timer">
            <div class="focus-blocker-timer-label">Ends in</div>
            <div class="focus-blocker-timer-value" id="focus-blocker-timer-value">∞</div>
          </div>
        </div>
        <div class="focus-blocker-footer">
        <div class="focus-blocker-branding" id="focus-blocker-branding">
          <span>Powered by</span>
          <div class="focus-blocker-branding-icon">
            <img src="${chrome.runtime.getURL('icon128.png')}" alt="">
          </div>
          <span>Focus Mode</span>
        </div>
          <div class="focus-blocker-divider"></div>
          <a href="https://buymeacoffee.com/arpitjpn" target="_blank" class="focus-blocker-coffee">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M2 21V19H20V21H2ZM20 8V5H3V8H2V4H21V8H20ZM18 17H3V8H18V17ZM19 8H21C21.55 8 22.021 8.196 22.413 8.588C22.805 8.98 23.001 9.451 23.001 10V13C23.001 13.55 22.805 14.021 22.413 14.413C22.021 14.805 21.55 15.001 21 15.001H19V13.001H21V10H19V8Z"/>
            </svg>
            <span>Buy me a coffee</span>
          </a>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Start timer if there's an end time
    if (endTime) {
      updateTimerDisplay(endTime);
    }

    // Handle branding click
    const branding = document.getElementById('focus-blocker-branding');
    if (branding) {
      branding.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openPopup' }).catch(() => {});
      });
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();

