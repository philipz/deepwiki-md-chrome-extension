// Utility functions are now loaded from utils.js

// Helper: Send a message to a tab's content script with auto-retry.
// If the content script is not loaded (e.g., extension reloaded without page refresh),
// re-inject it and retry the message.
async function sendMessageWithRetry(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (error.message && (
      error.message.includes('Receiving end does not exist') ||
      error.message.includes('Could not establish connection')
    )) {
      // Content script not loaded, re-inject
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
      } catch (injectError) {
        throw new Error('Failed to inject content script. Please refresh the page.');
      }
      // Wait for content script to initialize
      await new Promise(r => setTimeout(r, 1000));
      // Retry
      return await chrome.tabs.sendMessage(tabId, message);
    }
    throw error;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const convertBtn = document.getElementById('convertBtn');
  const batchDownloadBtn = document.getElementById('batchDownloadBtn');
  const batchSingleFileBtn = document.getElementById('batchSingleFileBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const status = document.getElementById('status');

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === 'batchUpdate') {
      applyBatchStatus(request);
    }
  });

  initializeBatchStatus();

  convertBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!isValidDeepWikiUrl(tab.url)) {
        showStatus('Please use this extension on a valid DeepWiki or Devin page (e.g., https://deepwiki.com/org/project)', 'error');
        return;
      }

      showStatus('Converting page...', 'info');
      const response = await sendMessageWithRetry(tab.id, { action: 'convertToMarkdown' });

      if (response && response.success) {
        const headTitle = sanitizeName(response.headTitle || '', '');
        const currentTitle = sanitizeName(response.markdownTitle, 'page');
        const fileName = headTitle
          ? `${headTitle}-${currentTitle}.md`
          : `${currentTitle}.md`;

        const blob = new Blob([response.markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);

        chrome.downloads.download({
          url,
          filename: fileName,
          saveAs: true
        });

        showStatus('Conversion successful! Downloading...', 'success');
      } else {
        showStatus('Conversion failed: ' + (response?.error || 'Unknown error'), 'error');
      }
    } catch (error) {
      showStatus('An error occurred: ' + error.message, 'error');
    }
  });

  batchDownloadBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!isValidDeepWikiUrl(tab.url)) {
        showStatus('Please use this extension on a valid DeepWiki or Devin page (e.g., https://deepwiki.com/org/project)', 'error');
        return;
      }

      showCancelButton(true);
      disableBatchButton(true);
      showStatus('Starting batch conversion...', 'info');

      const response = await chrome.runtime.sendMessage({ action: 'startBatch', tabId: tab.id });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start batch conversion.');
      }
    } catch (error) {
      showStatus('An error occurred: ' + error.message, 'error');
      showCancelButton(false);
      disableBatchButton(false);
    }
  });

  batchSingleFileBtn.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!isValidDeepWikiUrl(tab.url)) {
        showStatus('Please use this extension on a valid DeepWiki or Devin page (e.g., https://deepwiki.com/org/project)', 'error');
        return;
      }

      showCancelButton(true);
      disableBatchButton(true);
      showStatus('Starting single-file batch conversion...', 'info');

      const response = await chrome.runtime.sendMessage({ action: 'startBatchSingleFile', tabId: tab.id });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to start single-file batch conversion.');
      }
    } catch (error) {
      showStatus('An error occurred: ' + error.message, 'error');
      showCancelButton(false);
      disableBatchButton(false);
    }
  });

  cancelBtn.addEventListener('click', async () => {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'cancelBatch' });
      if (response && response.success) {
        showStatus('Cancelling batch operation...', 'info');
      } else {
        showStatus('No active batch operation to cancel.', 'info');
      }
    } catch (error) {
      showStatus('Unable to cancel batch: ' + error.message, 'error');
    }
  });

  async function initializeBatchStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getBatchStatus' });
      applyBatchStatus(response);
    } catch (error) {
      if (typeof DEBUG_MODE !== 'undefined' && DEBUG_MODE) {
        console.debug('Unable to fetch batch status:', error.message);
      }
    }
  }

  function applyBatchStatus(statusPayload) {
    if (!statusPayload) {
      return;
    }

    if (statusPayload.running) {
      showCancelButton(true);
      disableBatchButton(true);
    } else {
      showCancelButton(false);
      disableBatchButton(false);
    }

    if (statusPayload.message) {
      showStatus(statusPayload.message, statusPayload.level || 'info');
    }
  }

  function showCancelButton(show) {
    cancelBtn.style.display = show ? 'block' : 'none';
  }

  function disableBatchButton(disable) {
    batchDownloadBtn.disabled = disable;
    batchSingleFileBtn.disabled = disable;
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = type;
  }
});
