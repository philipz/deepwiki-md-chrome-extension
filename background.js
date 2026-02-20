importScripts('lib/jszip.min.js');
importScripts('utils.js');

const MESSAGE_TIMEOUT = 30000;
// Delay constants for page rendering to avoid rate limiting and ensure content loads
const PAGE_RENDER_BASE_DELAY = 3000;
const PAGE_RENDER_JITTER = 1000;

const messageQueue = {};

// Utility functions (sanitizeName and isValidDeepWikiUrl) are now loaded from utils.js

// Ensure the content script is loaded and responsive in a tab.
// If not, re-inject it using chrome.scripting.executeScript.
async function ensureContentScript(tabId) {
  try {
    const response = await Promise.race([
      attemptDirectMessage(tabId, { action: 'ping' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 3000))
    ]);
    if (response && response.pong) {
      markTabReady(tabId);
      flushMessageQueue(tabId);
      return;
    }
  } catch (e) {
    // Content script not responding, need to re-inject
    if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
      console.log(`Content script not responding on tab ${tabId}: ${e.message}. Re-injecting...`);
    }
  }

  // Re-inject content script
  // Register listener BEFORE executeScript to avoid race condition:
  // content.js sends contentScriptReady synchronously during execution,
  // and executeScript resolves only after the script finishes running.
  let readyTimeoutId;
  let readyHandler;
  const readyPromise = new Promise((resolve, reject) => {
    readyHandler = function (msg, sender) {
      if (msg.action === 'contentScriptReady' && sender.tab?.id === tabId) {
        clearTimeout(readyTimeoutId);
        chrome.runtime.onMessage.removeListener(readyHandler);
        resolve();
      }
    };
    readyTimeoutId = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(readyHandler);
      reject(new Error('Content script injection timeout'));
    }, 5000);
    chrome.runtime.onMessage.addListener(readyHandler);
  });
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    await readyPromise;
    markTabReady(tabId);
    flushMessageQueue(tabId);
  } catch (e) {
    // Clean up the readyPromise's timeout and listener to prevent
    // unhandled promise rejection when executeScript fails.
    clearTimeout(readyTimeoutId);
    chrome.runtime.onMessage.removeListener(readyHandler);
    readyPromise.catch(() => { }); // suppress the now-orphaned rejection
    throw new Error('Content script not available. Please refresh the page and try again.');
  }
}

const createInitialBatchState = () => ({
  isRunning: false,
  tabId: null,
  originalUrl: null,
  pages: [],
  convertedPages: [],
  folderName: '',
  processed: 0,
  failed: 0,
  cancelRequested: false,
  total: 0,
  currentTitle: '',
  fileNames: new Set(),
  isDevinButtonNav: false  // 是否使用按鈕點擊式導覽（Devin SPA 專用）
});

let batchState = createInitialBatchState();
let lastBatchReport = {
  type: 'idle',
  message: 'Batch converter ready.',
  level: 'info',
  processed: 0,
  failed: 0,
  total: 0,
  running: false
};

function markTabPending(tabId) {
  if (!messageQueue[tabId]) {
    messageQueue[tabId] = { isReady: false, queue: [] };
    return;
  }
  messageQueue[tabId].isReady = false;
}

function markTabReady(tabId) {
  if (!messageQueue[tabId]) {
    messageQueue[tabId] = { isReady: true, queue: [] };
  } else {
    messageQueue[tabId].isReady = true;
  }
}

function dispatchMessageToTab(tabId, item) {
  chrome.tabs.sendMessage(tabId, item.message, response => {
    if (chrome.runtime.lastError) {
      item.reject(new Error(chrome.runtime.lastError.message));
      return;
    }
    item.resolve(response);
  });
}

function flushMessageQueue(tabId) {
  const entry = messageQueue[tabId];
  if (!entry) return;
  entry.isReady = true;
  while (entry.queue.length > 0) {
    const payload = entry.queue.shift();
    dispatchMessageToTab(tabId, payload);
  }
}

function queueMessageForTab(tabId, message, resolve, reject) {
  if (!messageQueue[tabId]) {
    messageQueue[tabId] = { isReady: false, queue: [] };
  }

  const queueItem = {
    message,
    resolve: (response) => {
      clearTimeout(queueItem.timeoutId);
      resolve(response);
    },
    reject: (error) => {
      clearTimeout(queueItem.timeoutId);
      reject(error);
    }
  };

  queueItem.timeoutId = setTimeout(() => {
    queueItem.reject(new Error(`Timed out waiting for response for ${message.action}`));
  }, MESSAGE_TIMEOUT);

  messageQueue[tabId].queue.push(queueItem);
}

function attemptDirectMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function shouldQueueForError(error) {
  if (!error || !error.message) return false;
  return error.message.includes('Receiving end does not exist') ||
    error.message.includes('Could not establish connection');
}

function sendMessageToTab(tabId, message) {
  const entry = messageQueue[tabId];
  const tryDirect = () => attemptDirectMessage(tabId, message);

  if (entry && entry.isReady) {
    return tryDirect().catch(error => {
      // If a "ready" tab fails, it might be effectively dead/orphaned (e.g. extension updated).
      // We should re-evaluate if we should queue or fail.
      if (shouldQueueForError(error)) {
        // Check tab status to see if we should really queue
        return new Promise((resolve, reject) => {
          chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError || !tab) {
              reject(new Error('Tab no longer exists.'));
              return;
            }

            // Connection failed despite isReady=true (maybe refreshed?).
            // Mark as not ready and Queue.
            entry.isReady = false;
            queueMessageForTab(tabId, message, resolve, reject);
          });
        });
      }
      throw error;
    });
  }

  return tryDirect().catch(error => {
    if (!shouldQueueForError(error)) {
      throw error;
    }

    return new Promise((resolve, reject) => {
      // Before queuing, check if the tab still exists
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          reject(new Error('Tab no longer exists.'));
          return;
        }

        // Even if the tab is complete, the content script might effectively be
        // "loading" or re-initializing (e.g. after a reload). 
        // We should queue the message and wait for 'contentScriptReady'.
        // If it never comes, the queue timeout (MESSAGE_TIMEOUT) will handle it.
        queueMessageForTab(tabId, message, resolve, reject);
      });
    });
  });
}

function broadcastBatchUpdate(type, data = {}, overrideRunning) {
  const running = typeof overrideRunning === 'boolean' ? overrideRunning : batchState.isRunning;
  const payload = {
    action: 'batchUpdate',
    type,
    running,
    processed: data.processed ?? batchState.processed,
    failed: data.failed ?? batchState.failed,
    total: data.total ?? batchState.total,
    cancelRequested: batchState.cancelRequested,
    message: data.message || '',
    level: data.level || 'info'
  };

  lastBatchReport = payload;

  chrome.runtime.sendMessage(payload, () => {
    const error = chrome.runtime.lastError;
    if (error && error.message && !error.message.includes('Receiving end does not exist')) {
      if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
        console.debug('Batch update broadcast error:', error.message);
      }
    }
  });
}

function getBatchStatusPayload() {
  if (batchState.isRunning) {
    return {
      running: true,
      processed: batchState.processed,
      failed: batchState.failed,
      total: batchState.total,
      cancelRequested: batchState.cancelRequested,
      message: lastBatchReport.message,
      level: lastBatchReport.level,
      type: lastBatchReport.type
    };
  }

  const { action, ...rest } = lastBatchReport;
  return { running: false, ...rest };
}

function sanitizeName(value, fallback = 'page') {
  if (!value || typeof value !== 'string') return fallback;
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || fallback;
}

function getUniqueFileName(desired) {
  const base = sanitizeName(desired, 'page');
  let candidate = base;
  let counter = 1;
  while (batchState.fileNames.has(candidate)) {
    candidate = `${base}-${counter++}`;
  }
  batchState.fileNames.add(candidate);
  return candidate;
}

function resetBatchState() {
  batchState = createInitialBatchState();
}

function cancelBatchProcessing() {
  if (!batchState.isRunning) {
    return false;
  }
  batchState.cancelRequested = true;
  broadcastBatchUpdate('cancelling', {
    message: `Cancelling... processed ${batchState.processed}/${batchState.total}.`
  });
  return true;
}

async function restoreOriginalPage() {
  if (!batchState.tabId || !batchState.originalUrl) {
    return;
  }
  // Devin 的 SPA 頁面還原：點擊第一個側邊欄按鈕回到首頁
  // （因為 Devin 無法用 chrome.tabs.update 進行 URL 導覽）
  if (batchState.isDevinButtonNav) {
    try {
      await sendMessageToTab(batchState.tabId, {
        action: 'navigateDevinPage',
        buttonIndex: 0
      });
    } catch (error) {
      if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
        console.debug('Failed to restore Devin page via button click:', error.message);
      }
    } finally {
      batchState.originalUrl = null;
    }
    return;
  }
  try {
    await navigateToPage(batchState.tabId, batchState.originalUrl);
  } catch (error) {
    if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
      console.debug('Failed to restore original page:', error.message);
    }
  } finally {
    batchState.originalUrl = null;
  }
}

function navigateToPage(tabId, url) {
  markTabPending(tabId);
  return new Promise((resolve, reject) => {
    // Setup listeners BEFORE starting navigation to avoid race conditions
    // especially for fast hash/SPA updates.
    let timeoutId;

    function cleanup() {
      clearTimeout(timeoutId);
      chrome.webNavigation.onCompleted.removeListener(onCompleted);
      chrome.webNavigation.onReferenceFragmentUpdated.removeListener(onCompleted);
      chrome.webNavigation.onHistoryStateUpdated.removeListener(onCompleted);
      chrome.webNavigation.onErrorOccurred.removeListener(onError);
    }

    function onCompleted(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
          console.log(`Navigation complete (${details.transitionType || 'spa/hash'}):`, details.url);
        }
        cleanup();
        resolve();
      }
    }

    function onError(details) {
      if (details.tabId === tabId && details.frameId === 0) {
        cleanup();
        reject(new Error(details.error || 'Navigation error'));
      }
    }

    chrome.webNavigation.onCompleted.addListener(onCompleted);
    chrome.webNavigation.onReferenceFragmentUpdated.addListener(onCompleted);
    chrome.webNavigation.onHistoryStateUpdated.addListener(onCompleted);
    chrome.webNavigation.onErrorOccurred.addListener(onError);

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Navigation timeout.'));
    }, MESSAGE_TIMEOUT);

    chrome.tabs.update(tabId, { url }, () => {
      if (chrome.runtime.lastError) {
        cleanup(); // Clean up if update fails immediately
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      // Navigation started
    });
  });
}

async function processSinglePage(page) {
  if (batchState.cancelRequested) return;

  const currentStep = batchState.processed + batchState.failed + 1;
  batchState.currentTitle = page.title;
  broadcastBatchUpdate('processing', {
    message: `Processing ${currentStep}/${batchState.total}: ${page.title}`
  });

  if (batchState.isDevinButtonNav && page.buttonIndex !== undefined) {
    // Devin SPA 頁面切換：透過點擊側邊欄按鈕取代 URL 導覽，
    // 避免 SPA 將合成的 hash URL 重新導向到 wiki 首頁
    const navResponse = await sendMessageToTab(batchState.tabId, {
      action: 'navigateDevinPage',
      buttonIndex: page.buttonIndex
    });
    if (!navResponse || !navResponse.success) {
      throw new Error(navResponse?.error || 'Devin button navigation failed');
    }
  } else {
    await navigateToPage(batchState.tabId, page.url);
  }

  if (batchState.cancelRequested) return;

  // Wait for dynamic content to render.
  // Increased to PAGE_RENDER_BASE_DELAY + random buffer to avoid rate limiting and ensure large pages load.
  const delay = PAGE_RENDER_BASE_DELAY + Math.random() * PAGE_RENDER_JITTER;
  await new Promise(resolve => setTimeout(resolve, delay));

  const convertResponse = await sendMessageToTab(batchState.tabId, { action: 'convertToMarkdown' });
  if (!convertResponse || !convertResponse.success) {
    throw new Error(convertResponse?.error || 'Conversion failed');
  }

  const fileName = getUniqueFileName(convertResponse.markdownTitle || page.title);
  batchState.convertedPages.push({ title: fileName, content: convertResponse.markdown });
  batchState.processed += 1;
  broadcastBatchUpdate('pageProcessed', {
    message: `Converted ${batchState.processed}/${batchState.total}: ${page.title}`
  });
}

async function createZipArchive() {
  const zip = new JSZip();
  let indexContent = `# ${batchState.folderName}\n\n## Content Index\n\n`;

  batchState.convertedPages.forEach(page => {
    indexContent += `- [${page.title}](${page.title}.md)\n`;
    zip.file(`${page.title}.md`, page.content);
  });

  zip.file('README.md', indexContent);

  const base64Zip = await zip.generateAsync({
    type: 'base64',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const dataUrl = `data:application/zip;base64,${base64Zip}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: `${batchState.folderName}.zip`,
      saveAs: true
    }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function createSingleMarkdownFile(fileName) {
  // Merge all converted pages into a single Markdown file
  let combinedMarkdown = '';

  batchState.convertedPages.forEach((page, index) => {
    // Add page title as a heading
    combinedMarkdown += `# ${page.title}\n\n`;
    // Add page content
    combinedMarkdown += page.content;
    // Add separator between pages (except for the last page)
    if (index < batchState.convertedPages.length - 1) {
      combinedMarkdown += '\n\n---\n\n';
    }
  });

  // Create data URL for download
  // Note: URL.createObjectURL() is not available in service workers,
  // so we use base64 encoding instead. Using TextEncoder for proper UTF-8 handling.
  const encoder = new TextEncoder();
  const uint8Array = encoder.encode(combinedMarkdown);
  const binaryString = Array.from(uint8Array, byte => String.fromCharCode(byte)).join('');
  const base64Content = btoa(binaryString);
  const dataUrl = `data:text/markdown;charset=utf-8;base64,${base64Content}`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename: fileName,
      saveAs: true
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(downloadId);
    });
  });
}

async function runBatchProcessing() {
  try {
    for (const page of batchState.pages) {
      if (batchState.cancelRequested) {
        break;
      }

      try {
        await processSinglePage(page);
      } catch (error) {
        batchState.failed += 1;
        broadcastBatchUpdate('pageFailed', {
          message: `Failed ${page.title}: ${error.message || error}`,
          level: 'error'
        });
      }
    }

    if (batchState.cancelRequested) {
      batchState.isRunning = false;
      broadcastBatchUpdate('cancelled', {
        message: `Batch cancelled. Success ${batchState.processed}, Failed ${batchState.failed}.`
      }, false);
      return;
    }

    if (!batchState.convertedPages.length) {
      throw new Error('No pages were converted successfully.');
    }

    broadcastBatchUpdate('zipping', {
      message: `Creating ZIP with ${batchState.convertedPages.length} files...`
    });

    await createZipArchive();

    batchState.isRunning = false;
    broadcastBatchUpdate('completed', {
      message: `ZIP ready. Success ${batchState.processed}, Failed ${batchState.failed}.`,
      level: 'success'
    }, false);
  } catch (error) {
    batchState.isRunning = false;
    broadcastBatchUpdate('error', {
      message: error.message || 'Batch conversion failed.',
      level: 'error'
    }, false);
  } finally {
    await restoreOriginalPage();
    resetBatchState();
  }
}

async function runBatchSingleFileProcessing(fileName) {
  try {
    // Process all pages using the same logic as batch ZIP processing
    for (const page of batchState.pages) {
      if (batchState.cancelRequested) {
        break;
      }

      try {
        await processSinglePage(page);
      } catch (error) {
        batchState.failed += 1;
        broadcastBatchUpdate('pageFailed', {
          message: `Failed ${page.title}: ${error.message || error}`,
          level: 'error'
        });
      }
    }

    if (batchState.cancelRequested) {
      batchState.isRunning = false;
      broadcastBatchUpdate('cancelled', {
        message: `Batch cancelled. Success ${batchState.processed}, Failed ${batchState.failed}.`
      }, false);
      return;
    }

    if (!batchState.convertedPages.length) {
      throw new Error('No pages were converted successfully.');
    }

    broadcastBatchUpdate('merging', {
      message: `Merging ${batchState.convertedPages.length} pages into single file...`
    });

    await createSingleMarkdownFile(fileName);

    batchState.isRunning = false;
    broadcastBatchUpdate('completed', {
      message: `File ready. Success ${batchState.processed}, Failed ${batchState.failed}.`,
      level: 'success'
    }, false);
  } catch (error) {
    batchState.isRunning = false;
    broadcastBatchUpdate('error', {
      message: error.message || 'Single-file batch conversion failed.',
      level: 'error'
    }, false);
  } finally {
    await restoreOriginalPage();
    resetBatchState();
  }
}

function sanitizeFolderName(value) {
  return sanitizeName(value, 'deepwiki');
}

function getTabById(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function startBatchProcessing(tabId) {
  if (batchState.isRunning) {
    throw new Error('Batch conversion already running.');
  }

  const tab = await getTabById(tabId);
  if (!isValidDeepWikiUrl(tab.url)) {
    throw new Error('Please open a valid DeepWiki documentation page (e.g., https://deepwiki.com/org/project) before starting batch conversion.');
  }

  await ensureContentScript(tabId);
  const extraction = await sendMessageToTab(tabId, { action: 'extractAllPages' });
  if (!extraction || !extraction.success) {
    throw new Error(extraction?.error || 'Failed to extract sidebar links.');
  }

  const pages = extraction.pages || [];
  if (!pages.length) {
    throw new Error('No child pages were detected on this document.');
  }

  // Determine folder name based on domain and URL structure
  const urlObj = new URL(tab.url);
  const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);

  // Default extraction (DeepWiki default or Devin non-wiki)
  let org = sanitizeName(pathSegments[0] || 'org', 'org');
  let project = sanitizeName(pathSegments[1] || 'project', 'project');
  let fileNamePrefix = '';

  if (urlObj.hostname.includes('devin.ai')) {
    // Special case for Devin wiki URLs: /org/[org]/wiki/[user]/[project]
    const wikiIndex = pathSegments.indexOf('wiki');
    if (wikiIndex !== -1 && pathSegments[wikiIndex + 2]) {
      org = sanitizeName(pathSegments[1] || 'org', 'org'); // Org is usually first
      project = sanitizeName(pathSegments[wikiIndex + 2] || 'project', 'project');
    }
    fileNamePrefix = 'Devin-';
  }

  // Decide folder name
  let calculatedFolderName;
  if (urlObj.hostname.includes('devin.ai')) {
    calculatedFolderName = `${fileNamePrefix}${project}`; // Cleaner: just project name or Devin-Project
  } else {
    // Keep old behavior for DeepWiki Zip to avoid regression
    calculatedFolderName = sanitizeFolderName(extraction.headTitle || extraction.currentTitle || 'deepwiki');
  }

  batchState = {
    isRunning: true,
    tabId,
    originalUrl: tab.url,
    pages,
    convertedPages: [],
    folderName: calculatedFolderName,
    processed: 0,
    failed: 0,
    cancelRequested: false,
    total: pages.length,
    currentTitle: '',
    fileNames: new Set(),
    isDevinButtonNav: !!extraction.isDevinButtonNav  // 由 content.js 回傳，標記是否為 Devin 站台
  };

  broadcastBatchUpdate('started', {
    message: `Found ${batchState.total} pages. Starting batch conversion...`
  });

  runBatchProcessing();

  return {
    total: batchState.total,
    folderName: batchState.folderName
  };
}

async function startBatchSingleFileProcessing(tabId) {
  if (batchState.isRunning) {
    throw new Error('Batch conversion already running.');
  }

  const tab = await getTabById(tabId);
  if (!isValidDeepWikiUrl(tab.url)) {
    throw new Error('Please open a valid DeepWiki documentation page (e.g., https://deepwiki.com/org/project) before starting batch conversion.');
  }

  await ensureContentScript(tabId);
  const extraction = await sendMessageToTab(tabId, { action: 'extractAllPages' });
  if (!extraction || !extraction.success) {
    throw new Error(extraction?.error || 'Failed to extract sidebar links.');
  }

  const pages = extraction.pages || [];
  if (!pages.length) {
    throw new Error('No child pages were detected on this document.');
  }

  // Extract org and project from URL and sanitize for safe filenames
  const urlObj = new URL(tab.url);
  const pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);

  // Default extraction
  let org = sanitizeName(pathSegments[0] || 'org', 'org');
  let project = sanitizeName(pathSegments[1] || 'project', 'project');
  let fileNamePrefix = '';

  if (urlObj.hostname.includes('devin.ai')) {
    // Special case for Devin wiki URLs
    const wikiIndex = pathSegments.indexOf('wiki');
    if (wikiIndex !== -1 && pathSegments[wikiIndex + 2]) {
      org = sanitizeName(pathSegments[1] || 'org', 'org');
      project = sanitizeName(pathSegments[wikiIndex + 2] || 'project', 'project');
    }
    // User requested "Devin-" prefix for Devin downloads
    fileNamePrefix = 'Devin-';
  } else {
    // DeepWiki Logic
    // User requested to match "Download All Pages" (Zip) naming convention.
    // Zip uses: sanitizeFolderName(extraction.headTitle || extraction.currentTitle || 'deepwiki')
    // So we should do the same here.
    const titleBasedName = sanitizeName(extraction.headTitle || extraction.currentTitle || 'deepwiki');
    const lastIndexedDate = sanitizeName(extraction.lastIndexedDate || '', '');

    // Override the structured name generation for DeepWiki to match Zip behavior
    const fileName = lastIndexedDate
      ? `${titleBasedName}-${lastIndexedDate}.md`
      : `${titleBasedName}.md`;

    // Return early with this name for DeepWiki
    batchState = {
      isRunning: true,
      tabId,
      originalUrl: tab.url,
      pages,
      convertedPages: [],
      folderName: fileName.replace('.md', ''),
      processed: 0,
      failed: 0,
      cancelRequested: false,
      total: pages.length,
      currentTitle: '',
      fileNames: new Set(),
      isDevinButtonNav: false
    };

    broadcastBatchUpdate('started', {
      message: `Found ${batchState.total} pages. Starting single-file batch conversion...`
    });

    runBatchSingleFileProcessing(fileName);

    return {
      total: batchState.total,
      fileName: fileName
    };
  }

  const lastIndexedDate = sanitizeName(extraction.lastIndexedDate || '', '');

  // Generate sanitized filename
  // This block now only runs for Devin, as DeepWiki returns early above.
  const baseName = `${fileNamePrefix}${org}-${project}`;

  const fileName = lastIndexedDate
    ? `${baseName}-${lastIndexedDate}.md`
    : `${baseName}.md`;

  batchState = {
    isRunning: true,
    tabId,
    originalUrl: tab.url,
    pages,
    convertedPages: [],
    folderName: fileName.replace('.md', ''),
    processed: 0,
    failed: 0,
    cancelRequested: false,
    total: pages.length,
    currentTitle: '',
    fileNames: new Set(),
    isDevinButtonNav: !!extraction.isDevinButtonNav  // 由 content.js 回傳，標記是否為 Devin 站台
  };

  broadcastBatchUpdate('started', {
    message: `Found ${batchState.total} pages. Starting single-file batch conversion...`
  });

  runBatchSingleFileProcessing(fileName);

  return {
    total: batchState.total,
    fileName: fileName
  };
}

// Listen for extension installation event
chrome.runtime.onInstalled.addListener(() => {
  console.log('DeepWiki to Markdown extension installed');

  // Auto-inject content script into existing matching tabs
  // This ensures the extension works immediately after install/update without requiring a page refresh
  chrome.tabs.query({ url: ['https://deepwiki.com/*', 'https://app.devin.ai/*'] }, (tabs) => {
    if (chrome.runtime.lastError) return;
    for (const tab of tabs) {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(() => { /* Tab might not be injectable */ });
    }
  });
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'log') {
    console.log('Message from page:', request.message);
    return;
  }

  if (request.action === 'contentScriptReady') {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ status: 'no-tab' });
      return;
    }

    markTabReady(tabId);
    if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
      console.log(`DeepWiki Background: Received contentScriptReady from tab ${tabId}. Flushing queue...`);
    }
    flushMessageQueue(tabId);
    sendResponse({ status: 'ready' });
    return;
  }

  if (request.action === 'startBatch') {
    const tabId = request.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ success: false, error: 'Missing tabId for batch start.' });
      return;
    }

    startBatchProcessing(tabId)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'startBatchSingleFile') {
    const tabId = request.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ success: false, error: 'Missing tabId for single-file batch start.' });
      return;
    }

    startBatchSingleFileProcessing(tabId)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'cancelBatch') {
    const cancelled = cancelBatchProcessing();
    sendResponse({ success: cancelled });
    return;
  }

  if (request.action === 'getBatchStatus') {
    sendResponse(getBatchStatusPayload());
    return;
  }

  if (request.action === 'ensureContentScript') {
    const tabId = request.tabId;
    if (typeof tabId !== 'number') {
      sendResponse({ success: false, error: 'Missing tabId.' });
      return;
    }
    ensureContentScript(tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'extractMermaidSources') {
    // === 在 MAIN world 執行 React fiber 擷取 ===
    // 目的：從 React 的內部資料結構中擷取 mermaid 原始碼和程式碼語言資訊。
    // 原因：content script 在隔離的 world 中無法存取 __reactFiber$，
    //       而 CSP 又阻擋了 inline script，只能透過 chrome.scripting.executeScript
    //       以 world: 'MAIN' 在頁面的主執行環境中執行。
    // 結果：擷取到的資訊寫入 DOM 屬性（data-mermaid-source / data-code-language），
    //       content script 可以從隔離 world 中讀取（因為 DOM 是共享的）。
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab ID' });
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          const MERMAID_KEYWORDS = /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|gitGraph|mindmap)\b/;
          let count = 0;
          const allSvgs = document.querySelectorAll('svg[id^="mermaid-"]');

          // Pass 1：從 SVG 父元素的 React fiber 向上遍歷，搜尋 mermaid 原始碼
          // 搜尋 memoizedProps 中的 content/children/code/source/value 屬性，
          // 若值以 mermaid 關鍵字開頭（flowchart、sequenceDiagram 等），即為原始碼。
          // 搜尋深度上限 15 層（DeepWiki 約在第 12 層，Devin 約在第 8 層）。
          allSvgs.forEach(svg => {
            if (svg.getAttribute('data-mermaid-source')) return;
            try {
              const el = svg.closest('div') || svg.parentElement;
              if (!el) return;
              const fiberKey = Object.keys(el).find(k =>
                k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
              );
              if (!fiberKey) return;
              let fiber = el[fiberKey];
              for (let depth = 0; depth < 15 && fiber; depth++) {
                if (fiber.memoizedProps) {
                  const props = fiber.memoizedProps;
                  const candidates = [props.content, props.children, props.code, props.source, props.value];
                  for (const val of candidates) {
                    if (typeof val === 'string' && val.length > 10) {
                      const trimmed = val.trim();
                      if (MERMAID_KEYWORDS.test(trimmed)) {
                        svg.setAttribute('data-mermaid-source', trimmed);
                        count++;
                        return;
                      }
                    }
                  }
                }
                fiber = fiber.return;
              }
            } catch (e) { /* skip this SVG */ }
          });

          // Pass 2：處理孤兒錯誤 SVG
          // Devin 的 mermaid 渲染器在渲染失敗時，會將錯誤 SVG 拋到 body 下方，
          // 完全脫離 React 的 component tree（無 __reactFiber 屬性）。
          // 策略：BFS 遍歷整個 React fiber tree，收集所有 mermaid 原始碼，
          // 排除已在 Pass 1 中配對的，再按順序指派給孤兒 SVG。
          const orphanSvgs = [];
          allSvgs.forEach(svg => {
            if (!svg.getAttribute('data-mermaid-source')) orphanSvgs.push(svg);
          });

          if (orphanSvgs.length > 0) {
            // Collect all mermaid sources from React fiber tree
            const allMermaidSources = [];
            const contentArea = document.querySelector('[class*="wiki-content"]')
              || document.querySelector('main')
              || document.querySelector('[class*="markdown"]')
              || document.querySelector('article')
              || document.querySelector('#__next');

            if (contentArea) {
              // Walk the fiber tree from a React-managed element
              const reactEl = contentArea.querySelector('[class]') || contentArea;
              const fiberKey = Object.keys(reactEl).find(k =>
                k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
              );
              if (fiberKey) {
                // BFS/DFS through fiber tree to find all mermaid content props
                const visited = new Set();
                const queue = [reactEl[fiberKey]];
                while (queue.length > 0 && allMermaidSources.length < 200) {
                  const fiber = queue.shift();
                  if (!fiber || visited.has(fiber)) continue;
                  visited.add(fiber);
                  if (visited.size > 5000) break; // safety limit
                  if (fiber.memoizedProps) {
                    for (const key of ['content', 'children', 'code', 'source', 'value']) {
                      const val = fiber.memoizedProps[key];
                      if (typeof val === 'string' && val.length > 10 && MERMAID_KEYWORDS.test(val.trim())) {
                        allMermaidSources.push(val.trim());
                      }
                    }
                  }
                  if (fiber.child) queue.push(fiber.child);
                  if (fiber.sibling) queue.push(fiber.sibling);
                }
              }
            }

            // Remove sources already assigned to SVGs (from pass 1)
            const assignedSources = new Set();
            allSvgs.forEach(svg => {
              const src = svg.getAttribute('data-mermaid-source');
              if (src) assignedSources.add(src);
            });
            const unmatched = allMermaidSources.filter(s => !assignedSources.has(s));

            // Assign unmatched sources to orphan SVGs in order
            for (let i = 0; i < orphanSvgs.length && i < unmatched.length; i++) {
              orphanSvgs[i].setAttribute('data-mermaid-source', unmatched[i]);
              count++;
            }
          }

          // Pass 3：從 React fiber props 擷取程式碼區塊的語言資訊
          // DeepWiki 和 Devin 的 <code> 元素通常沒有 language-xxx class，
          // 但 React fiber 的 memoizedProps 中有 language/lang 屬性。
          // 搜尋 code 元素和其父 pre 元素的 fiber，深度上限 8 層。
          document.querySelectorAll('pre code').forEach(code => {
            if (code.getAttribute('data-code-language')) return;
            try {
              const el = code.closest('pre') || code.parentElement;
              if (!el) return;
              // Check code element first, then pre element
              for (const target of [code, el]) {
                const fk = Object.keys(target).find(k =>
                  k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
                );
                if (!fk) continue;
                let f = target[fk];
                for (let d = 0; d < 8 && f; d++) {
                  if (f.memoizedProps) {
                    const lang = f.memoizedProps.language || f.memoizedProps.lang;
                    if (typeof lang === 'string' && lang.length > 0 && lang.length < 30) {
                      code.setAttribute('data-code-language', lang);
                      return;
                    }
                    // Check className for language-* pattern
                    const cn = f.memoizedProps.className;
                    if (typeof cn === 'string') {
                      const m = cn.match(/language-(\S+)/);
                      if (m) {
                        code.setAttribute('data-code-language', m[1]);
                        return;
                      }
                    }
                  }
                  f = f.return;
                }
              }
            } catch (e) { /* skip */ }
          });

          return count;
        } catch (e) {
          return 0;
        }
      }
    }).then(results => {
      const count = results?.[0]?.result || 0;
      sendResponse({ success: true, count });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  if (request.action === 'pageLoaded' || request.action === 'tabActivated') {
    sendResponse({ received: true });
    return;
  }

  return false;
});

// Listen for tab updates to reset readiness and notify content scripts
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url || (!tab.url.includes('deepwiki.com') && !tab.url.includes('devin.ai'))) {
    return;
  }

  if (changeInfo.status === 'loading') {
    markTabPending(tabId);
  }

  if (changeInfo.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { action: 'pageLoaded' }, () => {
      const error = chrome.runtime.lastError;
      if (error && !error.message.includes('Receiving end does not exist')) {
        console.log('Page loaded ping error:', error.message);
      } else if (!error) {
        // Ping succeeded, so content script is ready!
        markTabReady(tabId);
        flushMessageQueue(tabId);
      }
    });
  }
});

// Keep content script informed when a DeepWiki tab becomes active
chrome.tabs.onActivated.addListener(activeInfo => {
  chrome.tabs.get(activeInfo.tabId, tab => {
    if (tab && tab.url && (tab.url.includes('deepwiki.com') || tab.url.includes('devin.ai'))) {
      chrome.tabs.sendMessage(activeInfo.tabId, { action: 'tabActivated' }, () => {
        const error = chrome.runtime.lastError;
        if (error && !error.message.includes('Receiving end does not exist')) {
          console.log('Tab activated ping error:', error.message);
        } else if (!error) {
          // Ping succeeded, mark as ready
          markTabReady(activeInfo.tabId);
          flushMessageQueue(activeInfo.tabId);
        }
      });
    }
  });
});

// Clean up the queue when a tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  if (messageQueue[tabId]) {
    messageQueue[tabId].queue.forEach(item => item.reject(new Error('Tab closed.')));
    delete messageQueue[tabId];
  }

  if (batchState.isRunning && batchState.tabId === tabId) {
    batchState.isRunning = false;
    batchState.cancelRequested = true;
    broadcastBatchUpdate('error', {
      message: 'Batch cancelled because the tab was closed.',
      level: 'error'
    }, false);
    resetBatchState();
  }
});
