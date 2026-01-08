# Focus Mode - Website Blocker for Productivity

A Chrome extension that blocks distracting websites to help you stay focused and productive.

## ✨ Features

- **One-Click Toggle** — Enable/disable blocking instantly
- **Custom Block List** — Block YouTube, Twitter, Reddit, Instagram, or any site
- **Flexible Timers** — Block for 15min, 30min, 1hr, 2hrs, or custom duration
- **Infinite Mode** — Block until you manually turn it off
- **Smart Wildcards** — Automatically blocks subdomains
- **Beautiful Block Page** — Motivational overlay when visiting blocked sites
- **Live Countdown** — See exactly when blocking ends
- **Sync Across Devices** — Settings sync via your Google account
- **100% Free** — No premium tiers, no subscriptions

## 🚀 Installation

### From Chrome Web Store (Recommended)
*Coming soon*

### Manual Installation (Developer Mode)

1. Download or clone this repository
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the extension folder

## 📖 Usage

1. Click the Focus Mode icon in your toolbar
2. Add distracting websites to your block list
3. Set a timer duration (or leave on infinite)
4. Toggle blocking **ON**
5. Stay focused!

## 🔒 Privacy

Focus Mode respects your privacy:
- No data collection
- No analytics or tracking
- No external servers
- 100% local storage
- Fully open source

[Read our full Privacy Policy](PRIVACY.md)

## 🛠️ How It Works

- Uses Chrome's `declarativeNetRequest` API (Manifest V3)
- Blocks all resource types (pages, media, scripts, etc.)
- Displays an overlay on blocked pages
- Settings sync via `chrome.storage.sync`

## 📁 Project Structure

```
focus-blocker/
├── manifest.json        # Extension configuration
├── background.js        # Service worker (blocking rules)
├── popup.html/js/css    # Extension popup UI
├── content-blocker.js   # Blocked page overlay
├── blocked.html/js      # Fallback blocked page
└── icon*.png            # Extension icons
```

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs via [Issues](https://github.com/arpitjp/focus-blocker/issues)
- Submit pull requests
- Suggest new features

## 📄 License

MIT License - Free for personal and commercial use.

---

Made with ☕ to help you stay focused.
