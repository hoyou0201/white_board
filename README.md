# Memo Whiteboard

An infinite whiteboard for sticky notes and arrows. Notes are saved in the
current browser with `localStorage`.

## Requirements

- Node.js 22.13 or newer
- npm

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed in the terminal.

## Main files

- `app/page.tsx`: whiteboard behavior and interface
- `app/globals.css`: layout and visual styling
- `app/layout.tsx`: page metadata and shared HTML shell
- `worker/index.ts`: Cloudflare Worker entry point

## Build and deploy

```bash
npm run build
npx wrangler login
npm run deploy
```

The first deployment opens a browser to connect a Cloudflare account.
