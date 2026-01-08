// Starting rule ID for our blocking rules
const RULE_ID_START = 1;

// Initialize extension
chrome.runtime.onInstalled.addListener(async () => {
  await updateBlockingRules();
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateBlocking' || message.action === 'updateRules') {
    updateBlockingRules();
  }
  sendResponse({ success: true });
});

// Update blocking rules based on storage state
async function updateBlockingRules() {
  try {
    // Check both sync (Google account) and local storage
    const syncResult = await chrome.storage.sync.get(['blockingEnabled', 'blockedSites']);
    const localResult = await chrome.storage.local.get(['blockingEnabled', 'blockedSites']);
    
    // Prefer sync storage, fallback to local
    const enabled = syncResult.blockingEnabled ?? localResult.blockingEnabled ?? false;
    const blockedSites = syncResult.blockedSites ?? localResult.blockedSites ?? [];

    // Get existing dynamic rules to remove only our rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ourRuleIds = existingRules
      .filter(rule => rule.id >= RULE_ID_START && rule.id < RULE_ID_START + 10000)
      .map(rule => rule.id);

    // Prepare update object
    const update = {
      removeRuleIds: ourRuleIds.length > 0 ? ourRuleIds : undefined
    };

    // Only add blocking rules if enabled and there are sites to block
    if (enabled && blockedSites.length > 0) {
      const rules = [];
      let ruleId = RULE_ID_START;

      blockedSites.forEach((site) => {
        // Check if the site is a subdomain (contains dots beyond the TLD)
        const parts = site.split('.');
        const isSubdomain = parts.length > 2;
        
        if (isSubdomain) {
          // For subdomains like music.youtube.com, block only that specific subdomain
          // This does NOT block youtube.com or other subdomains
          rules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.BLOCK
            },
            condition: {
              urlFilter: `*://${site}/*`,
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME
              ]
            }
          });
          
          // Also block www. version of the subdomain
          rules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.BLOCK
            },
            condition: {
              urlFilter: `*://www.${site}/*`,
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME
              ]
            }
          });
        } else {
          // For main domains like youtube.com, block the domain AND all subdomains
          // Use *.youtube.com pattern to block all subdomains (music.youtube.com, studio.youtube.com, etc.)
          rules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.BLOCK
            },
            condition: {
              urlFilter: `*://${site}/*`,
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME
              ]
            }
          });

          // Block www. subdomain
          rules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.BLOCK
            },
            condition: {
              urlFilter: `*://www.${site}/*`,
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME
              ]
            }
          });

          // Block all other subdomains using wildcard pattern
          rules.push({
            id: ruleId++,
            priority: 1,
            action: {
              type: chrome.declarativeNetRequest.RuleActionType.BLOCK
            },
            condition: {
              urlFilter: `*://*.${site}/*`,
              resourceTypes: [
                chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
                chrome.declarativeNetRequest.ResourceType.SUB_FRAME
              ]
            }
          });
        }
      });

      // Add rules to update object
      if (rules.length > 0) {
        update.addRules = rules;
      }
    }

    // Perform atomic update: remove old rules and add new ones in a single call
    // This prevents race conditions and duplicate ID errors
    if (update.removeRuleIds || update.addRules) {
      await chrome.declarativeNetRequest.updateDynamicRules(update);
    }
  } catch (error) {
    console.error('Error updating blocking rules:', error);
  }
}

// Listen for storage changes to update rules
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync') {
    updateBlockingRules();
  }
});

