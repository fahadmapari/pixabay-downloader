<img width="358" height="385" alt="image" src="https://github.com/user-attachments/assets/453ecd06-01ce-48ee-8a29-51cbb43d076e" />


# Pixabay Downloader

A Chrome extension + Cloudflare Worker that proxies Pixabay image downloads
through Cloudflare's IP pool — so Pixabay's rate limits never affect you.

```
Browser (tab URL)
    └─► Chrome Extension  ──POST imageId──►  Cloudflare Worker
                                                  │
                                           Pixabay API (resolve webformatURL)
                                                  │
                                           Pixabay CDN  ◄── Cloudflare IP
                                                  │
                          ◄──── image stream ─────┘
```

---

## Quick start

### 1 — Get a free Pixabay API key

Sign up at https://pixabay.com/api/docs/ and copy your key.

---

### 2 — Deploy the Cloudflare Worker

You need Node.js installed.

```bash
cd worker

# Install Wrangler CLI globally
npm install -g wrangler

# Log in to Cloudflare
wrangler login

# Add your Pixabay key as a secret (never hardcoded in code)
wrangler secret put PIXABAY_KEY
# → paste your key when prompted

# Deploy
wrangler deploy
```

Your worker URL will look like:
`https://pixabay-proxy.<your-subdomain>.workers.dev`

Copy it — you'll need it in step 4.

---

### 3 — Load the Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Toggle **Developer mode** ON (top-right)
3. Click **Load unpacked**
4. Select the `extension/` folder

The extension icon (4 squares) will appear in your toolbar.

---

### 4 — Configure the Worker URL

1. Click the extension icon
2. In the **Worker URL** field at the bottom, paste your worker URL
3. Click **Save**

---

## Usage

1. Navigate to any Pixabay image page  
   e.g. `https://pixabay.com/photos/mountains-lake-reflection-5234052/`
2. Click the extension icon — it auto-detects the page and shows a preview
3. Click **Download Image**
4. The file is saved to your `Downloads/Pixabay/` folder

You can also paste any Pixabay URL manually into the input field.

---

## File structure

```
pixabay-downloader/
├── README.md
│
├── worker/
│   ├── index.js          Cloudflare Worker — proxy + API resolver
│   └── wrangler.toml     Deployment config
│
└── extension/
    ├── manifest.json     Chrome MV3 manifest
    ├── popup.html        Extension UI (dark, Vercel-style)
    ├── popup.js          All extension logic
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## Notes

- Images download at `webformatURL` resolution (up to ~1920px), available on the free Pixabay API tier.
- The worker validates that only numeric Pixabay IDs are accepted — no arbitrary proxy usage.
- Your API key is stored as a Cloudflare Worker secret and never exposed to the browser.
- Files are saved to `Downloads/Pixabay/<tags>-<id>.jpg` automatically.
