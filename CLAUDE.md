# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome MV3 extension that converts DeepWiki (`deepwiki.com`) and Devin (`app.devin.ai`) documentation pages to Markdown. Three modes: single page, batch ZIP, batch single-file merge.

## Common Commands

```bash
# Install / reload as unpacked extension
# 1) chrome://extensions/  → Developer mode ON
# 2) "Load unpacked" → select repo root
# 3) Re-click the 🔄 reload icon after every code change

# Build a Chrome Web Store zip (reads version from manifest.json)
./build-for-store.sh
# → produces deepwiki-md-extension-v<version>.zip

# Toggle verbose logging
# Edit content.js:7  → const DEBUG_MODE = true;   (then reload extension)
# DEBUG_MODE=true ALSO enables execution on arbitrary file:// pages — leave false in production.

# Test on file:// pages (test/test-page.html, test/quick-test.js)
# Required: chrome://extensions/ → "Details" → enable "Allow access to file URLs"
# Otherwise the content script will not load and you will see "Could not establish connection".
```

There is no test runner, lint, typecheck, or build pipeline. `package.json` declares `jsdom` and `mermaid` for ad-hoc local repros (`test/repro_*.js`, `test/generate_svg.mjs`), but defines no scripts. Tests are manual against either real DeepWiki/Devin pages or `test/test-page.html`.

## Architecture

Three message endpoints — popup ↔ background ↔ content script — coordinate over `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage`. The non-obvious complexity lives in **how readiness is synchronized** during SPA navigation and extension reloads.

### Files

- `manifest.json` — MV3, host permissions for `deepwiki.com/*` and `app.devin.ai/*`. Permissions: `downloads`, `tabs`, `webNavigation`, `scripting`.
- `background.js` (service worker) — batch orchestration, per-tab message queue, SPA navigation, ZIP/file generation. Loads `lib/jszip.min.js` and `utils.js` via `importScripts`.
- `content.js` — DOM → Markdown conversion (`processNode`), sidebar extraction (`extractAllPages`, `getDevinSidebarLinks`). Wrapped in an IIFE with a version guard (`window.__deepwikiVersion`) so re-injection cleanly supersedes the prior instance.
- `popup.js` / `popup.html` — UI with three buttons + cancel; defers re-injection to background via `ensureContentScript`.
- `utils.js` — shared `sanitizeName` and `isValidDeepWikiUrl` (loaded by both background and popup).

### Key invariants

**Tab readiness queue (`background.js`).** `messageQueue[tabId] = { isReady, queue }` buffers any message destined for a tab whose content script hasn't yet sent `contentScriptReady`. Flushed by `flushMessageQueue` once ready. This is what lets batch processing fire the next `convertToMarkdown` immediately after navigation without racing the freshly re-injected content script. When initiating an action that re-mounts the content script from inside the page (rather than via `chrome.tabs.update`), the background must call `markTabPending(tabId)` *before* sending and pass `forceDirect=true` to `sendMessageToTab`, otherwise the message would be queued and never delivered.

**Content script readiness signal (`content.js`).** Sends `chrome.runtime.sendMessage({ action: 'contentScriptReady' })` synchronously at IIFE start *and* again on `window load`. Background has a listener registered **before** `chrome.scripting.executeScript` resolves (see `ensureContentScript`) — this avoids a documented race where `executeScript` resolves only after the script body finishes, by which time a synchronous `contentScriptReady` could have already fired.

**SPA navigation completion.** `navigateToPage` listens to `webNavigation.onCompleted` + `onReferenceFragmentUpdated` + `onHistoryStateUpdated` simultaneously, because Devin/DeepWiki use a mix of full loads, hash updates, and history pushState. All three listeners share one `cleanup`.

**Version guard for re-injection.** `content.js` increments `window.__deepwikiVersion` and every message handler short-circuits if `window.__deepwikiVersion !== __v`. This is required because reloading the extension (without refreshing the page) leaves stale event listeners from earlier injections.

**Devin sidebar = real links, matched structurally.** Devin's wiki nav is `li[data-slot="sidebar-menu-item"] > a[href]` pointing at `/org/{org}/wiki/{user}/{project}/page/{chapter}`. `getDevinSidebarLinks` keeps only anchors whose href contains both `/wiki/` and `/page/`; `extractAllPages`'s `filterPrefix` then scopes them to the current project. The `<a>` is an `absolute inset-0` overlay with **no text** — the title comes from `aria-label`. Chapter numbers are **not** derived from indentation; `deriveChapterNumber` reads them straight out of the URL's last path segment (`page/1.1` → `1.1`).

Because these are ordinary links, Devin batches navigate through `navigateToPage` (`chrome.tabs.update`) exactly like DeepWiki — there is no in-page click path. Do **not** reintroduce label deny-list matching over `button[aria-label]`: it silently captured app chrome (`Search`, `Collapse sidebar`, `Help`), and batch mode clicked `Search`, opening Devin's command palette instead of navigating. Regression test: `test/repro_devin_sidebar.js` against `test/fixture_devin_sidebar.html`.

**Content-extraction selectors are site-specific.** DeepWiki uses `.container > div:nth-child(2) .prose`; Devin uses `.prose-main` / `.prose` / `article` / `main`. `convertToMarkdown` retries up to 20× at 500ms intervals if the container has fewer than 50 chars of text — this guards against capturing a half-rendered React tree.

**URL gate (`utils.js:isValidDeepWikiUrl`).** Hostname must be exactly `deepwiki.com`, `*.deepwiki.com`, or `app.devin.ai` (no substring matching — `evil-deepwiki.com` is rejected) **and** the path must have ≥2 segments. `file://` and `localhost`/`127.0.0.1` are accepted only when the URL contains `test-page.html` or `test/`. Mirror this any time you add a new permitted origin: update both `manifest.json` (`host_permissions` + `content_scripts.matches`) and `isValidDeepWikiUrl`.

**Local-file execution gate (`content.js:ALLOW_SCRIPT_EXECUTION`).** Defense-in-depth on top of the URL gate: on `file://`, the content script no-ops unless the URL is a known test page or `DEBUG_MODE=true`. When this guard short-circuits, **no `ping` handler is registered** — that's intentional, so background detects the dead instance and falls through to error/re-injection paths.

**Filenames.** ZIP mode uses page head/current title (`sanitizeFolderName`). Single-file merge: DeepWiki uses `<headTitle>[-<lastIndexedDate>].md`; Devin uses `Devin-<org>-<project>[-<lastIndexedDate>].md`. Sanitization in `sanitizeName` strips `\/:*?"<>|`, collapses whitespace and runs of `-`, and trims leading/trailing `-`. Within a single batch, `getUniqueFileName` appends `-1`, `-2`, … to deduplicate.

### Message contract (background ↔ content)

| Action | Direction | Payload | Notes |
|---|---|---|---|
| `ping` | bg → cs | — | `{ pong: true }`; used by `ensureContentScript` |
| `contentScriptReady` | cs → bg | — | Fires twice per load (sync + window.load); flushes queue |
| `convertToMarkdown` | bg/popup → cs | — | Returns `{ success, markdown, markdownTitle, headTitle }` |
| `extractAllPages` | bg → cs | — | Wrapped in `setTimeout(…, 0)` to force async — callers rely on `return true` keeping the channel open |
| `pageLoaded` / `tabActivated` | bg → cs | — | Liveness pings on tab updates; cs must `sendResponse({ received: true })` |
| `startBatch` / `startBatchSingleFile` / `cancelBatch` / `getBatchStatus` | popup → bg | `{ tabId? }` | |
| `batchUpdate` | bg → popup | progress payload | Broadcast; popup also calls `getBatchStatus` on open to recover state |
| `ensureContentScript` | popup → bg | `{ tabId }` | Popup delegates re-injection here instead of doing it itself |

### When editing

- **New permitted origin** → update `manifest.json` host_permissions + content_scripts.matches, AND `isValidDeepWikiUrl`, AND any hostname checks in `background.js` (`tab.url.includes('deepwiki.com')`/`'devin.ai'`) and `content.js` (`hostname.includes('devin.ai')`). All three layers must agree.
- **New async message handler in `content.js`** → `return true` from the listener so the channel stays open; mirror in `background.js` if it sends back. Prefer wrapping the body in `setTimeout(…, 0)` (see `extractAllPages`) to avoid the "channel closed" failure mode.
- **Action that re-mounts the content script** → call `markTabPending(tabId)` first, then `sendMessageToTab(..., true)` (forceDirect). The next `contentScriptReady` flushes the queue.
- **Don't bypass `processNode`'s ignore list** (`button`, `svg`, `path`, `sr-only`, `invisible`, `hidden`, and `Copy code` / `Link copied!` text) — these filter UI chrome that DeepWiki injects into the article DOM.
- **Don't `console.log` outside `if (DEBUG_MODE)`** in production paths — verbose logging is gated behind that flag everywhere except top-level lifecycle messages.
