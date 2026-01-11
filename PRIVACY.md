# Privacy Policy

**Last updated:** January 12, 2026

## Overview

Pip Focus is committed to protecting your privacy. This extension does not collect, store, or transmit any personal data to external servers.

## Data Collection

**We collect nothing.** Specifically:

- ❌ No personal information
- ❌ No browsing history
- ❌ No analytics or tracking
- ❌ No cookies
- ❌ No advertising identifiers

## Data Storage

All your settings (blocked websites, timer preferences) are stored **locally in your browser** using Chrome's built-in storage API (`chrome.storage.sync` and `chrome.storage.local`).

If you're signed into Chrome with a Google account, your settings may sync across your devices. This syncing is handled entirely by Chrome/Google — Pip Focus does not operate any servers.

## Permissions Explained

Pip Focus requests the following permissions:

| Permission | Why We Need It |
|------------|----------------|
| `storage` | Save your blocked sites list and preferences |
| `tabs` | Detect when you visit a blocked site |
| `declarativeNetRequest` | Block network requests to blocked sites |
| `scripting` | Show the "blocked" overlay on blocked pages |
| `webNavigation` | Detect page navigation to blocked sites |
| `alarms` | Timer functionality for auto-unblocking |
| `host_permissions` | Required to block any website you choose |

## Third-Party Services

Pip Focus does **not** use any third-party services, analytics platforms, or external APIs.

## Open Source

This extension is fully open source. You can review the complete source code at:
https://github.com/arpitjp/focus-mode-chrome-extension

## Data Deletion

Since no data is collected externally, there's nothing to delete from our end. To remove all local data, simply uninstall the extension from Chrome.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on GitHub:
https://github.com/arpitjp/focus-mode-chrome-extension/issues

---

**TL;DR:** Pip Focus stores your settings locally in your browser. We don't collect any data. Period.
