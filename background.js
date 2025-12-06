importScripts('lib/jszip.min.js');
importScripts('utils.js');

const MESSAGE_TIMEOUT = 30000;
const messageQueue = {};

// Utility functions (sanitizeName and isValidDeepWikiUrl) are now loaded from utils.js

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
  fileNames: new Set()
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
    return tryDirect();
  }

  return tryDirect().catch(error => {
    if (!shouldQueueForError(error)) {
      throw error;
    }

    return new Promise((resolve, reject) => {
      queueMessageForTab(tabId, message, resolve, reject);
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

  await navigateToPage(batchState.tabId, page.url);
  if (batchState.cancelRequested) return;

  // Wait for dynamic content (Mermaid diagrams) to render
  await new Promise(resolve => setTimeout(resolve, 2000));

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

  let org, project;
  let fileNamePrefix = '';

  if (urlObj.hostname.includes('devin.ai')) {
    if (pathSegments[0] === 'wiki') {
      org = sanitizeName(pathSegments[1] || 'org', 'org');
      project = sanitizeName(pathSegments[2] || 'project', 'project');
    } else {
      org = sanitizeName(pathSegments[0] || 'org', 'org');
      project = sanitizeName(pathSegments[1] || 'project', 'project');
    }
    fileNamePrefix = 'Devin-';
  } else {
    org = sanitizeName(pathSegments[0] || 'org', 'org');
    project = sanitizeName(pathSegments[1] || 'project', 'project');
    fileNamePrefix = '';
  }

  // Decide folder name
  let calculatedFolderName;
  if (urlObj.hostname.includes('devin.ai')) {
    calculatedFolderName = `${fileNamePrefix}${org}-${project}`;
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
    fileNames: new Set()
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

  let org, project;
  let fileNamePrefix = '';

  if (urlObj.hostname.includes('devin.ai')) {
    // Devin Logic
    // URL: /wiki/org/project -> segments: ['wiki', 'org', 'project']
    if (pathSegments[0] === 'wiki') {
      org = sanitizeName(pathSegments[1] || 'org', 'org');
      project = sanitizeName(pathSegments[2] || 'project', 'project');
    } else {
      // Fallback if URL structure is different on Devin
      org = sanitizeName(pathSegments[0] || 'org', 'org');
      project = sanitizeName(pathSegments[1] || 'project', 'project');
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
      fileNames: new Set()
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
    fileNames: new Set()
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

    if (!messageQueue[tabId]) {
      messageQueue[tabId] = { isReady: true, queue: [] };
    } else {
      messageQueue[tabId].isReady = true;
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

  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    markTabPending(tabId);
  }

  if (changeInfo.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { action: 'pageLoaded' }, () => {
      const error = chrome.runtime.lastError;
      if (error && !error.message.includes('Receiving end does not exist')) {
        console.log('Page loaded ping error:', error.message);
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
