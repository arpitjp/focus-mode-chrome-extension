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
  let scrollPreventHandler = null;

  // Stop all media on the page
  function killAllMedia() {
    // Stop all video elements (including in shadow DOM)
    const killVideos = (root) => {
      const videos = root.querySelectorAll ? root.querySelectorAll('video') : root.getElementsByTagName('video');
      for (const video of videos) {
        try {
          video.pause();
          video.muted = true;
          video.src = '';
          video.srcObject = null;
          video.remove();
        } catch (e) {}
      }
    };
    
    // Stop all audio elements
    const killAudios = (root) => {
      const audios = root.querySelectorAll ? root.querySelectorAll('audio') : root.getElementsByTagName('audio');
      for (const audio of audios) {
        try {
          audio.pause();
          audio.muted = true;
          audio.src = '';
          audio.srcObject = null;
          audio.remove();
        } catch (e) {}
      }
    };
    
    // Kill media in main document
    killVideos(document);
    killAudios(document);
    
    // Kill media in shadow DOMs (YouTube uses these)
    const walkShadowRoots = (node) => {
      if (node.shadowRoot) {
        killVideos(node.shadowRoot);
        killAudios(node.shadowRoot);
        node.shadowRoot.querySelectorAll('*').forEach(walkShadowRoots);
      }
      node.querySelectorAll && node.querySelectorAll('*').forEach(child => {
        if (child.shadowRoot) {
          killVideos(child.shadowRoot);
          killAudios(child.shadowRoot);
          walkShadowRoots(child);
        }
      });
    };
    try { walkShadowRoots(document.body); } catch (e) {}
    
    // Remove all iframes (YouTube embeds, etc.)
    const iframes = document.getElementsByTagName('iframe');
    for (let i = iframes.length - 1; i >= 0; i--) {
      try {
        iframes[i].src = 'about:blank';
        iframes[i].remove();
      } catch (e) {}
    }
    
    // Suspend AudioContext instances (Web Audio API)
    if (window.AudioContext || window.webkitAudioContext) {
      try {
        // Override to prevent new audio contexts
        const OriginalAudioContext = window.AudioContext || window.webkitAudioContext;
        window.AudioContext = function() {
          const ctx = new OriginalAudioContext();
          ctx.suspend();
          return ctx;
        };
        window.webkitAudioContext = window.AudioContext;
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
    if (storageListener && chrome.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(storageListener);
      storageListener = null;
    }
    if (messageListener && chrome.runtime?.onMessage) {
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
      // Restore scrolling
      if (document.body) {
        document.body.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
      }
      document.documentElement.style.overflow = '';
      // Remove scroll prevention listeners
      if (scrollPreventHandler) {
        window.removeEventListener('scroll', scrollPreventHandler);
        window.removeEventListener('wheel', scrollPreventHandler);
        window.removeEventListener('touchmove', scrollPreventHandler);
        scrollPreventHandler = null;
      }
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
      updateStatusDisplay(changes.blockingEndTime.newValue);
    }
  };
  if (chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener(storageListener);
  }
  
  // Message listener for direct updates from background
  messageListener = (message) => {
    if (message.action === 'timerUpdated') {
      if (message.enabled === false) {
        removeOverlay();
      } else {
        updateStatusDisplay(message.endTime);
      }
    }
  };
  if (chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener(messageListener);
  }
  
  // Update status line display
  function updateStatusDisplay(endTime) {
    currentEndTime = endTime;
    const statusEl = document.getElementById('focus-blocker-status');
    if (!statusEl) return;
    
    if (!endTime) {
      statusEl.textContent = 'Focus Mode active';
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    }
    
    // Update immediately then start interval (every minute, less ticking)
    updateStatusText(statusEl, endTime);
    
    if (!timerInterval) {
      timerInterval = setInterval(() => {
        if (currentEndTime) {
          updateStatusText(statusEl, currentEndTime);
        }
      }, 60000); // Update every minute
    }
  }
  
  function updateStatusText(statusEl, endTime) {
    const remaining = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
    
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600);
      const minutes = Math.ceil((remaining % 3600) / 60);
      
      let timeStr;
      if (hours > 0) {
        timeStr = `${hours}h ${minutes}m`;
      } else if (minutes > 0) {
        timeStr = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
      } else {
        timeStr = 'less than a minute';
      }
      statusEl.textContent = `Focus Mode active · Unblocks in ${timeStr}`;
    } else {
      removeOverlay();
    }
  }

  // Wait for DOM to be ready before checking/showing overlay
  function initBlocking() {
    // Get blocking info from storage
    if (!chrome.storage?.sync) {
      cleanup();
      return;
    }
    chrome.storage.sync.get(['blockingEnabled', 'blockedSites', 'blockingEndTime'], (syncResult) => {
      if (!chrome.storage?.local) {
        cleanup();
        return;
      }
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
        // *domain → matches anywhere (all subdomains)
        // https://domain → exact domain match only (NOT subdomains)
        const matchedSite = blockedSites.find(site => {
          if (site.startsWith('*')) {
            // Wildcard: match anywhere in URL (includes subdomains like music.youtube.com)
            return currentUrl.includes(site.substring(1).toLowerCase());
          } else if (site.startsWith('http://') || site.startsWith('https://')) {
            // Full URL: exact domain match only, NOT subdomains
            try {
              const ruleUrl = new URL(site.toLowerCase());
              const pageUrl = new URL(currentUrl);
              const ruleDomain = ruleUrl.hostname.replace(/^www\./, '');
              const pageDomain = pageUrl.hostname.replace(/^www\./, '');
              return ruleDomain === pageDomain;
            } catch {
              return currentUrl.startsWith(site.toLowerCase());
            }
          } else {
            return currentUrl.includes(site.toLowerCase());
          }
        });

        if (matchedSite) {
          // Try to extract site name from page title (e.g., "Video - YouTube" -> "YouTube")
          let displaySite = null;
          const title = document.title || '';
          const separators = [' - ', ' | ', ' – ', ' — '];
          for (const sep of separators) {
            if (title.includes(sep)) {
              displaySite = title.split(sep).pop().trim();
              break;
            }
          }
          // Fallback to hostname without TLD
          if (!displaySite || displaySite.length > 20) {
            const hostname = window.location.hostname.replace(/^www\./, '');
            const parts = hostname.split('.');
            displaySite = parts.length > 1 ? parts[parts.length - 2] : parts[0];
          }
          // Capitalize first letter
          displaySite = displaySite.charAt(0).toUpperCase() + displaySite.slice(1);
          showBlockedOverlay(displaySite, endTime);
        } else {
          cleanup();
        }
      });
    });
  }

  // Ensure DOM is ready before initializing
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBlocking);
  } else {
    // DOM already loaded, init immediately
    initBlocking();
  }

  function showBlockedOverlay(site, endTime) {
    if (document.getElementById('focus-blocker-overlay')) return;

    // Kill all media immediately
    killAllMedia();
    
    // Kill a few more times to catch delayed media, then stop
    // No need for continuous monitoring - overlay blocks interaction and tab is muted
    let killCount = 0;
    mediaKillerInterval = setInterval(() => {
      killAllMedia();
      killCount++;
      if (killCount >= 3) {
        clearInterval(mediaKillerInterval);
        mediaKillerInterval = null;
      }
    }, 1000);
    
    // One-time mutation observer - kill media once if DOM changes, then disconnect
    // This catches any media that loads after initial kill
    mediaObserver = new MutationObserver(() => {
      killAllMedia();
      mediaObserver.disconnect();
      mediaObserver = null;
    });
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
          background: #050508 !important;
          z-index: 2147483647 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          overflow: hidden !important;
          isolation: isolate !important;
          color-scheme: dark !important;
        }
        #focus-blocker-overlay::before,
        #focus-blocker-overlay::after {
          content: '' !important;
          position: absolute !important;
          width: 600px !important;
          height: 600px !important;
          border-radius: 50% !important;
          filter: blur(150px) !important;
          opacity: 0.35 !important;
          pointer-events: none !important;
          animation: focusGlowFloat 25s ease-in-out infinite !important;
        }
        #focus-blocker-overlay::before {
          background: radial-gradient(circle, #5b7fff 0%, transparent 70%) !important;
          top: -200px !important;
          right: -150px !important;
          left: auto !important;
        }
        #focus-blocker-overlay::after {
          background: radial-gradient(circle, #a78bfa 0%, transparent 70%) !important;
          bottom: -200px !important;
          left: -150px !important;
          top: auto !important;
          right: auto !important;
          animation-delay: -12s !important;
        }
        @keyframes focusGlowFloat {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -20px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.95); }
        }
        #focus-blocker-overlay * {
          box-sizing: border-box !important;
          filter: none !important;
          -webkit-filter: none !important;
          mix-blend-mode: normal !important;
        }
        #focus-blocker-overlay img {
          opacity: 1 !important;
          filter: none !important;
          -webkit-filter: none !important;
          transform: none !important;
          mix-blend-mode: normal !important;
          image-rendering: auto !important;
          -webkit-backface-visibility: visible !important;
          backface-visibility: visible !important;
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
          gap: 32px !important;
          margin-bottom: 56px !important;
        }
        .focus-blocker-text-group {
          text-align: left !important;
        }
        .focus-blocker-title {
          font-size: clamp(18px, 4vw, 28px) !important;
          font-weight: 700 !important;
          background: linear-gradient(90deg, #5b7fff 0%, #a78bfa 25%, #f0f0f5 50%, #a78bfa 75%, #5b7fff 100%) !important;
          background-size: 400% 100% !important;
          animation: focusTextShimmer 8s ease-in-out infinite !important;
          -webkit-background-clip: text !important;
          -webkit-text-fill-color: transparent !important;
          background-clip: text !important;
          margin-bottom: 8px !important;
          white-space: nowrap !important;
        }
        @keyframes focusTextShimmer {
          0%, 100% { background-position: 100% 50%; }
          50% { background-position: 0% 50%; }
        }
        @media (max-width: 600px) {
          .focus-blocker-title {
            white-space: normal !important;
          }
        }
        .focus-blocker-site-name {
          color: #fff !important;
          -webkit-text-fill-color: #fff !important;
        }
        .focus-blocker-status {
          font-size: 14px !important;
          color: #6b7280 !important;
          line-height: 1.5 !important;
          letter-spacing: 0.3px !important;
          font-weight: 400 !important;
        }
        .focus-blocker-icon {
          width: 72px !important;
          height: 72px !important;
          flex-shrink: 0 !important;
          cursor: pointer !important;
          transition: transform 0.2s ease !important;
        }
        .focus-blocker-icon:hover {
          transform: scale(1.05) !important;
        }
        .focus-blocker-icon img {
          width: 100% !important;
          height: 100% !important;
          object-fit: contain !important;
        }
      </style>
      <div class="focus-blocker-container">
        <div class="focus-blocker-header">
          <div class="focus-blocker-icon" id="focus-blocker-icon" title="Open Focus Mode settings">
            <img src="${chrome.runtime.getURL('icon128.png')}" alt="Focus Mode">
          </div>
          <div class="focus-blocker-text-group">
            <h1 class="focus-blocker-title">Access to <span class="focus-blocker-site-name">${escapeHtml(site)}</span> is blocked</h1>
            <p class="focus-blocker-status" id="focus-blocker-status">Focus Mode active</p>
          </div>
        </div>
      </div>
    `;

    // Append to body if available, otherwise documentElement
    try {
      if (document.body) {
        document.body.appendChild(overlay);
        // Prevent scrolling on both html and body
        document.body.style.cssText += 'overflow: hidden !important; position: fixed !important; width: 100% !important; height: 100% !important;';
        document.documentElement.style.cssText += 'overflow: hidden !important;';
      } else {
        document.documentElement.appendChild(overlay);
        document.documentElement.style.cssText += 'overflow: hidden !important;';
      }
    } catch (e) {
      // Fallback: try documentElement
      try {
        document.documentElement.appendChild(overlay);
      } catch (e2) {
        console.error('Focus Mode: Could not show overlay', e2);
      }
    }
    
    // Also prevent scroll events
    scrollPreventHandler = (e) => e.preventDefault();
    window.addEventListener('scroll', scrollPreventHandler, { passive: false });
    window.addEventListener('wheel', scrollPreventHandler, { passive: false });
    window.addEventListener('touchmove', scrollPreventHandler, { passive: false });

    // Start timer if there's an end time
    if (endTime) {
      updateStatusDisplay(endTime);
    }

    // Handle icon click to open settings
    const icon = document.getElementById('focus-blocker-icon');
    if (icon) {
      icon.addEventListener('click', () => {
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

