// Content script that overlays a "blocked" message on blocked sites
// This approach keeps the tab on the original URL, so it survives extension reloads

(function() {
  // Check if already initialized to prevent multiple instances
  if (window.__focusBlockerInitialized) return;
  window.__focusBlockerInitialized = true;

  // Store references for cleanup
  let timerInterval = null;
  let storageListener = null;
  let brandingClickHandler = null;
  let mediaObserver = null;
  let mediaKillerInterval = null;

  // Stop all media on the page
  function killAllMedia() {
    // Stop all video elements
    document.querySelectorAll('video').forEach(video => {
      video.pause();
      video.muted = true;
      video.src = '';
      video.srcObject = null;
      video.load();
    });
    
    // Stop all audio elements
    document.querySelectorAll('audio').forEach(audio => {
      audio.pause();
      audio.muted = true;
      audio.src = '';
      audio.srcObject = null;
      audio.load();
    });
    
    // Remove all iframes (YouTube embeds, etc.)
    document.querySelectorAll('iframe').forEach(iframe => {
      iframe.src = 'about:blank';
    });
    
    // Stop any playing media via Web Audio API (if possible)
    if (window.AudioContext) {
      try {
        const contexts = window.__audioContexts || [];
        contexts.forEach(ctx => ctx.close && ctx.close());
      } catch (e) {}
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
    const branding = document.getElementById('focus-blocker-branding');
    if (branding && brandingClickHandler) {
      branding.removeEventListener('click', brandingClickHandler);
      brandingClickHandler = null;
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
    if (changes.blockingEnabled && !changes.blockingEnabled.newValue) {
      removeOverlay();
    }
  };
  chrome.storage.onChanged.addListener(storageListener);

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
          const domain = site.substring(1).toLowerCase();
          return currentUrl.includes(domain);
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
    // Check if overlay already exists
    if (document.getElementById('focus-blocker-overlay')) return;

    // IMMEDIATELY kill all media
    killAllMedia();
    
    // Keep killing media periodically (in case site tries to restart it)
    mediaKillerInterval = setInterval(killAllMedia, 500);
    
    // Watch for new media elements being added
    mediaObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.addedNodes.length) {
          killAllMedia();
        }
      }
    });
    mediaObserver.observe(document.documentElement, { 
      childList: true, 
      subtree: true 
    });

    // Create overlay container
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
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f0f23 100%) !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        }
        #focus-blocker-overlay * {
          box-sizing: border-box !important;
        }
        .focus-blocker-container {
          text-align: center !important;
          padding: 40px !important;
          max-width: 500px !important;
        }
        .focus-blocker-icon {
          width: 80px !important;
          height: 80px !important;
          margin: 0 auto 24px auto !important;
          background: rgba(102, 126, 234, 0.2) !important;
          border-radius: 20px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          animation: focus-pulse 2s ease-in-out infinite !important;
        }
        @keyframes focus-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.05); opacity: 0.8; }
        }
        .focus-blocker-icon svg {
          width: 40px !important;
          height: 40px !important;
        }
        .focus-blocker-title {
          font-size: 28px !important;
          font-weight: 700 !important;
          margin-bottom: 12px !important;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          background-clip: text !important;
        }
        .focus-blocker-subtitle {
          font-size: 16px !important;
          color: #a0aec0 !important;
          margin-bottom: 24px !important;
          line-height: 1.5 !important;
        }
        .focus-blocker-site {
          display: inline-block !important;
          background: rgba(102, 126, 234, 0.2) !important;
          border: 1px solid rgba(102, 126, 234, 0.3) !important;
          padding: 8px 20px !important;
          border-radius: 20px !important;
          font-size: 14px !important;
          color: #667eea !important;
          font-weight: 500 !important;
          margin-bottom: 24px !important;
        }
        .focus-blocker-timer {
          background: rgba(102, 126, 234, 0.1) !important;
          border: 1px solid rgba(102, 126, 234, 0.2) !important;
          border-radius: 12px !important;
          padding: 16px 24px !important;
          margin-bottom: 24px !important;
        }
        .focus-blocker-timer-label {
          font-size: 11px !important;
          color: #718096 !important;
          text-transform: uppercase !important;
          letter-spacing: 1px !important;
          margin-bottom: 6px !important;
        }
        .focus-blocker-timer-value {
          font-size: 24px !important;
          font-weight: 700 !important;
          color: #667eea !important;
        }
        .focus-blocker-branding {
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
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
          width: 16px !important;
          height: 16px !important;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
          border-radius: 3px !important;
        }
      </style>
      <div class="focus-blocker-container">
        <div class="focus-blocker-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="#667eea" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
        </div>
        <h1 class="focus-blocker-title">Stay Focused!</h1>
        <p class="focus-blocker-subtitle">This website has been blocked to help you stay productive.</p>
        <div class="focus-blocker-site">${escapeHtml(site)}</div>
        <div class="focus-blocker-timer" id="focus-blocker-timer">
          <div class="focus-blocker-timer-label">Blocking ends in</div>
          <div class="focus-blocker-timer-value" id="focus-blocker-timer-value">∞ Until you turn it off</div>
        </div>
        <div class="focus-blocker-branding" id="focus-blocker-branding">
          <div class="focus-blocker-branding-icon"></div>
          <span>Focus Mode</span>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    // Prevent scrolling on the underlying page
    document.body.style.overflow = 'hidden';

    // Start timer if there's an end time
    if (endTime) {
      updateTimer(endTime);
      timerInterval = setInterval(() => updateTimer(endTime), 1000);
    }

    // Handle branding click - store reference for cleanup
    brandingClickHandler = () => {
      chrome.runtime.sendMessage({ action: 'openPopup' });
    };
    const branding = document.getElementById('focus-blocker-branding');
    if (branding) {
      branding.addEventListener('click', brandingClickHandler);
    }
  }

  function updateTimer(endTime) {
    const timerValue = document.getElementById('focus-blocker-timer-value');
    if (!timerValue) {
      // Element gone, clean up interval
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    }

    const now = Date.now();
    const remaining = Math.max(0, Math.floor((endTime - now) / 1000));

    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.floor((remaining % 3600) / 60);
      const secs = remaining % 60;

      let timeStr;
      if (hours > 0) {
        timeStr = `${hours}h ${minutes}m ${secs}s`;
      } else if (minutes > 0) {
        timeStr = `${minutes}m ${secs}s`;
      } else {
        timeStr = `${secs}s`;
      }
      timerValue.textContent = timeStr;
    } else {
      // Timer expired - remove overlay and clean up
      removeOverlay();
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
