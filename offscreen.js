// Listen for chime request
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'offscreen_playChime') {
    playChime().then(() => sendResponse({ success: true }));
    return true; // Keep channel open for async response
  }
  return true;
});

// Debounce to prevent double-playing
let lastPlayTime = 0;
const DEBOUNCE_MS = 3000; // Don't play again within 3 seconds

async function playChime() {
  // Prevent double-play
  const now = Date.now();
  if (now - lastPlayTime < DEBOUNCE_MS) {
    return;
  }
  lastPlayTime = now;
  
  try {
    const audio = new Audio(chrome.runtime.getURL('assets/ding.mp3'));
    await audio.play();
  } catch (e) {
    // Audio playback failed - non-critical, ignore
  }
}
