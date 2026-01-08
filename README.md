# Website Blocker Chrome Extension

A Chrome extension that allows you to block websites with an easy on/off toggle.

## Features

- **Toggle blocking on/off**: Easily enable or disable website blocking
- **Add/remove blocked sites**: Manage your list of blocked websites
- **Modern UI**: Clean and intuitive interface
- **Persistent storage**: Your settings are saved across browser sessions

## Installation

1. **Download or clone this repository**

2. **Open Chrome Extensions page**
   - Go to `chrome://extensions/`
   - Or navigate to: Chrome menu → More tools → Extensions

3. **Enable Developer mode**
   - Toggle the "Developer mode" switch in the top right corner

4. **Load the extension**
   - Click "Load unpacked"
   - Select the folder containing the extension files

5. **Add extension icons** (optional)
   - The extension references icon files (`icon16.png`, `icon48.png`, `icon128.png`)
   - You can create simple placeholder icons or use any 16x16, 48x48, and 128x128 pixel images
   - Place them in the extension folder

## Usage

1. **Click the extension icon** in your Chrome toolbar to open the popup

2. **Toggle blocking on/off**
   - Use the toggle switch at the top to enable or disable blocking

3. **Add websites to block**
   - Enter a website domain (e.g., `facebook.com` or `twitter.com`)
   - Click "Add" or press Enter
   - The extension will automatically handle variations (www, subdomains, etc.)

4. **Remove blocked websites**
   - Click the "Remove" button next to any site in your blocked list

## How It Works

- Uses Chrome's `declarativeNetRequest` API (Manifest V3) to block websites
- When blocking is enabled, requests to blocked sites are intercepted and blocked
- Settings are stored in Chrome's sync storage, so they persist across devices (if sync is enabled)

## Files Structure

```
focus/
├── manifest.json      # Extension configuration
├── popup.html        # Popup UI structure
├── popup.css         # Popup styling
├── popup.js          # Popup logic and UI interactions
├── background.js     # Service worker for blocking logic
└── README.md         # This file
```

## Notes

- The extension blocks both main frames and subframes
- It handles common URL variations (www, subdomains, http/https)
- Chrome limits dynamic rules to 30,000 per extension, so very large block lists may need optimization

## Development

To modify the extension:

1. Make your changes to the files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

## Permissions

The extension requires:
- `declarativeNetRequest`: To block network requests
- `storage`: To save your settings
- `tabs`: To interact with browser tabs
- `<all_urls>`: To block any website

## License

This project is open source and available for personal use.

