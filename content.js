; (function () {
  // Version guard: supports re-injection after extension reload without page refresh
  var __v = (window.__deepwikiVersion || 0) + 1;
  window.__deepwikiVersion = __v;

  // Debug flag to control verbose logging (set to false in production)
  const DEBUG_MODE = true; // Hardcoded to true for debugging, or set to false for production

  // Security check: Only allow local file access in debug mode or for test pages
  // For Devin.ai, we want to be permissive to ensure it runs
  const ALLOW_SCRIPT_EXECUTION = (function () {
    const currentUrl = window.location.href;
    const isLocalFile = currentUrl.startsWith('file://');

    if (!isLocalFile) {
      // Always allow on non-local files (e.g., https://deepwiki.com, devin.ai)
      return true;
    }

    // Check if it's a test page
    const isTestPage = currentUrl.includes('test-page.html') || currentUrl.includes('/test/');

    if (isTestPage) {
      return true;
    }

    // For other local files, only allow in debug mode
    if (DEBUG_MODE) {
      console.log('DeepWiki to Markdown: Running in DEBUG mode on local file');
      return true;
    }

    // Block execution on other local files in production mode
    console.info('DeepWiki to Markdown: Skipping local file (not a test page). Set DEBUG_MODE=true to enable.');
    return false;
  })();

  // Early exit if script execution is not allowed.
  // Intentionally no ping handler here: background must detect this instance
  // as non-functional so it can trigger re-injection or proper error handling.
  if (!ALLOW_SCRIPT_EXECUTION) return;

  // START OF EXTENSION LOGIC
  console.log("DeepWiki Content Script: Loaded and running on", window.location.href);

  // VISUAL DEBUGGING: Red border removed
  if (DEBUG_MODE) {
    console.log("DeepWiki Content Script: Debug mode enabled.");
  }

  // Notify background script IMMEDIATELY that we are ready to receive messages.
  // This prevents race conditions where background queues messages but we haven't signalled readiness yet.
  try {
    chrome.runtime.sendMessage({ action: "contentScriptReady" });
    if (DEBUG_MODE) console.log("DeepWiki Content Script: Sent contentScriptReady signal");
  } catch (e) {
    if (DEBUG_MODE) console.error("DeepWiki Content Script: Failed to send ready signal", e);
  }

  // Backup: Send ready signal again on window load to ensure background gets it
  window.addEventListener('load', () => {
    chrome.runtime.sendMessage({ action: "contentScriptReady" });
  });

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Version guard: ignore messages if a newer version of the script is active
    if (window.__deepwikiVersion !== __v) return false;

    // Ping handler for connectivity checks
    if (request.action === "ping") {
      sendResponse({ pong: true });
      return false;
    }

    if (request.action === "convertToMarkdown") {
      const MAX_RETRIES = 20;
      const RETRY_INTERVAL = 500;

      const attemptConversion = async (attempt = 0) => {
        try {
          // Get page title from head
          const headTitle = document.title || "";
          const formattedHeadTitle = headTitle.replace(/[\/|]/g, '-').replace(/\s+/g, '-').replace('---', '-');

          // Get article title
          const title =
            document.querySelector('.container > div:nth-child(1) a[data-selected="true"]')?.textContent?.trim() ||
            document.querySelector(".container > div:nth-child(1) h1")?.textContent?.trim() ||
            document.querySelector("h1")?.textContent?.trim() ||
            "Untitled";

          // Get article content container
          let contentContainer;
          if (window.location.hostname.includes('devin.ai')) {
            // Devin-specific selector (verified via debugging)
            contentContainer =
              document.querySelector('.prose-main') ||
              document.querySelector('.prose') ||
              document.querySelector('article') ||
              document.querySelector('main');
          } else {
            contentContainer =
              document.querySelector(".container > div:nth-child(2) .prose") ||
              document.querySelector(".container > div:nth-child(2) .prose-custom") ||
              document.querySelector(".container > div:nth-child(2)") ||
              document.body;
          }

          // Check if content is truly ready (heuristic: not empty, or specific loading state)
          // For Devin, contentContainer might exist but be empty during loading
          if (!contentContainer || contentContainer.innerText.trim().length < 50) { // Arbitrary threshold
            if (attempt < MAX_RETRIES) {
              if (DEBUG_MODE) console.log(`Content not ready (attempt ${attempt + 1}), retrying...`);
              setTimeout(() => attemptConversion(attempt + 1), RETRY_INTERVAL);
              return;
            } else {
              if (DEBUG_MODE) console.warn("Content extraction failed after retries, proceeding with what we have.");
            }
          }

          let markdown = ``;
          let markdownTitle = title.replace(/\s+/g, '-');

          if (contentContainer) {
            // 在轉換前，先透過 background.js 以 MAIN world 執行腳本，
            // 從 React fiber 的 memoizedProps 中擷取 mermaid 原始碼與程式語言資訊，
            // 並寫入 data-mermaid-source / data-code-language 屬性供後續讀取。
            // 因為 content script 在隔離的世界中無法存取 __reactFiber$，
            // 而 CSP 又阻擋了 inline <script>，所以必須透過 background 呼叫
            // chrome.scripting.executeScript({ world: 'MAIN' }) 來繞過限制。
            // 此邏輯同時適用於 DeepWiki (Next.js) 和 Devin (React)。
            if (contentContainer.querySelector('svg[id^="mermaid-"]') ||
                contentContainer.querySelector('pre code')) {
              await injectMermaidSourceExtractor();
            }

            contentContainer.childNodes.forEach((child) => {
              markdown += processNode(child);
            });
          }

          markdown = markdown.trim().replace(/\n{3,}/g, "\n\n");

          sendResponse({
            success: true,
            markdown,
            markdownTitle,
            headTitle: formattedHeadTitle
          });
        } catch (error) {
          console.error("Error converting to Markdown:", error);
          sendResponse({ success: false, error: error.message });
        }
      };

      attemptConversion();
      return true; // Indicates async response
    } else if (request.action === "extractAllPages") {
      // 2026-02-16 Fix: Ensure sendResponse is ALWAYS called to prevent timeout
      // 2026-02-16 Fix: Wrap in setTimeout to force true async execution
      // This prevents "channel closed" or "timeout" errors when return true is used.
      setTimeout(() => {
        try {
          if (DEBUG_MODE) console.log("Devin: extractAllPages request received.");

          // Get the head title
          const headTitle = document.title || "";
          // Format head title: replace slashes and pipes with dashes
          const formattedHeadTitle = headTitle.replace(/[\/|]/g, '-').replace(/\s+/g, '-').replace('---', '-');

          // Get the base part of the current document path
          // Use href (full URL) to ensure hash links (#item) are resolved relative to the current page path, not just the root domain.
          const baseUrl = window.location.href;

          const hostname = window.location.hostname;
          let sidebarLinks = [];

          if (hostname.includes('devin.ai')) {
            // Devin AI sidebar logic
            if (DEBUG_MODE) console.log('Devin: Detecting sidebar links...');

            // Strategy: Devin 2.0 uses buttons for sidebar items, not just UL/LI.
            // We need to capture these buttons and generate hash links for them.

            // 1. Find the sidebar container
            let sidebarContainer = document.querySelector('div[class*="w-[--sidebar-main-width]"]');

            // Fallback for sidebar detection if the class changes
            if (!sidebarContainer || sidebarContainer.querySelectorAll('button').length === 0) {
              // Try to find any vertical list of buttons on the left side
              const potentialContainers = Array.from(document.querySelectorAll('div, aside, nav'));
              const validContainer = potentialContainers.find(div => {
                const rect = div.getBoundingClientRect();
                // Check if it's on the left side and has decent height
                if (rect.left > 100 || rect.width > 400 || rect.height < 300) return false;

                // Must contain multiple buttons
                const btns = div.querySelectorAll('button');
                if (btns.length < 3) return false;

                // Check if buttons look like nav items (text-align left, etc - heuristic)
                return true;
              });

              if (validContainer) {
                sidebarContainer = validContainer;
                if (DEBUG_MODE) console.log('Devin: Found sidebar via generic left-column heuristic', sidebarContainer);
              }
            }

            if (sidebarContainer) {
              // Refined Selector: Only target BUTTONS. 
              // Previous logic might have been too broad if it included 'a' tags disguised as buttons, 
              // but querySelectorAll('button') should strict.
              // We adding data-slot check if possible, but class check is fragile.
              // The browser inspection showed wiki pages are <button> and others are <a>.
              const buttons = Array.from(sidebarContainer.querySelectorAll('button'));

              if (buttons.length > 0) {
                let counters = [];

                // Filter buttons that are likely nav items
                const navButtons = buttons.filter(btn => {
                  const text = btn.innerText.trim();
                  // Exclude common non-wiki buttons found in sidebar
                  if (!text) return false;
                  if (['Add repo', 'New chat', 'Import repository', 'Create new'].some(exclude => text.includes(exclude))) return false;

                  // Ensure it's not a global nav item that somehow got implemented as a button
                  // (Though inspection showed they are <a> tags, safety first)
                  if (['Sessions', 'Ask', 'Wiki', 'Review', 'Settings', 'Back'].includes(text)) return false;

                  return true;
                });

                // Extract Org Name from URL for exclusion (e.g. /org/philip-zheng/ -> Philip Zheng)
                const pathParts = window.location.pathname.split('/');
                const orgIndex = pathParts.indexOf('org');
                let orgName = '';
                if (orgIndex !== -1 && pathParts[orgIndex + 1]) {
                  orgName = pathParts[orgIndex + 1].replace(/-/g, ' '); // philip-zheng -> philip zheng
                }

                // Second pass filter for Org Name / Workspace selector
                const finalButtons = navButtons.filter(btn => {
                  const text = btn.innerText.trim();
                  if (orgName && text.toLowerCase().includes(orgName.toLowerCase())) return false;
                  return true;
                });

                finalButtons.forEach((button, index) => {
                  const text = button.textContent.trim();
                  const rect = button.getBoundingClientRect();

                  // Store raw data for processing
                  counters.push({
                    element: button,
                    text: text,
                    left: rect.left,
                    buttonIndex: index  // 儲存按鈕索引，供批次下載時以點擊方式切換頁面
                  });
                });

                // Calculate indentation baseline
                if (counters.length > 0) {
                  const minLeft = Math.min(...counters.map(c => c.left));
                  const INDENT_THRESHOLD = 8;

                  // Support Level 2 pages (Hierarchy) by removing the strict filter
                  // and calculating prefixes (1, 1.1, 1.2, 2...)
                  let hierarchyStack = [0];

                  // Determine Base URL for Wiki
                  const pathParts = window.location.pathname.split('/');
                  const wikiIndex = pathParts.indexOf('wiki');
                  let wikiBaseUrl = window.location.origin;

                  if (wikiIndex !== -1 && pathParts[wikiIndex + 2]) {
                    // Path structure: /org/[org]/wiki/[user]/[project]
                    // wikiIndex points to 'wiki'. 
                    // +1 is [user], +2 is [project].
                    // We need to capture up to [project].
                    // slice is exclusive, so +3.
                    const basePath = pathParts.slice(0, wikiIndex + 3).join('/');
                    wikiBaseUrl += basePath;
                  }

                  sidebarLinks = counters.map((item) => {
                    // Determine Level based on indentation
                    const offset = item.left - minLeft;
                    const level = offset < INDENT_THRESHOLD ? 0 : 1;

                    // Update Hierarchy Stack
                    if (level > hierarchyStack.length - 1) {
                      hierarchyStack.push(1);
                    } else if (level < hierarchyStack.length - 1) {
                      while (hierarchyStack.length - 1 > level) {
                        hierarchyStack.pop();
                      }
                      hierarchyStack[level]++;
                    } else {
                      hierarchyStack[level]++;
                    }

                    const prefix = hierarchyStack.join('.');

                    // Use Hash-based navigation as this seems to be the pattern for sub-sections
                    // e.g. .../project#1.1
                    // This avoids full page reloads and 404s on synthesized paths.
                    const fullUrl = `${wikiBaseUrl}#${prefix}`;

                    return {
                      getAttribute: (attr) => (attr === 'href' ? fullUrl : null),
                      textContent: item.text,
                      href: fullUrl,
                      text: item.text,
                      hierarchicalTitle: `${prefix} ${item.text}`,
                      buttonIndex: item.buttonIndex  // 傳遞按鈕索引供點擊式導覽使用
                    };
                  });

                  if (DEBUG_MODE) {
                    console.log(`DeepWiki: Found ${sidebarLinks.length} total pages (Level 1 & 2).`);
                  }
                }
              }
            } else {
              if (DEBUG_MODE) console.log("Devin: No sidebar container found.");
            }

            if (DEBUG_MODE) console.log(`Devin: Synthesized links found: ${sidebarLinks.length}`);

          } else {
            // DeepWiki logic (original)
            sidebarLinks = Array.from(document.querySelectorAll('.border-r-border ul li a'));
          }

          // Generic fallback - DISABLED FOR DEVIN to prevent "Back" link navigation
          if (sidebarLinks.length === 0 && !hostname.includes('devin.ai')) {
            sidebarLinks = Array.from(document.querySelectorAll('nav a, aside a'));
          }

          // Extract link URLs and titles
          let pages = sidebarLinks.map(link => {
            return {
              url: new URL(link.getAttribute('href'), baseUrl).href,
              // Use hierarchical title (1.1 Title) if available, otherwise fallback to text content
              title: link.hierarchicalTitle || link.textContent.trim(),
              selected: link.getAttribute('data-selected') === 'true',
              buttonIndex: link.buttonIndex  // Devin 批次下載使用按鈕索引進行點擊式導覽
            };
          });

          // 頁面 URL 過濾邏輯：
          // Devin 的側邊欄可能包含其他專案的連結，需要根據 wiki base URL 過濾。
          // DeepWiki 的側邊欄選擇器 (.border-r-border ul li a) 本身已限定在正確的 repo 範圍內，
          // 不需要額外過濾，否則會因為 filterPrefix 使用完整路徑而只匹配到當前頁面。

          if (hostname.includes('devin.ai')) {
            let filterPrefix = window.location.origin + window.location.pathname;
            const pathParts = window.location.pathname.split('/');
            const wikiIndex = pathParts.indexOf('wiki');
            // Capture up to project name: /org/[org]/wiki/[user]/[project]
            if (wikiIndex !== -1 && pathParts[wikiIndex + 2]) {
              const basePath = pathParts.slice(0, wikiIndex + 3).join('/');
              filterPrefix = window.location.origin + basePath;
            }
            pages = pages.filter(page => page.url.startsWith(filterPrefix));
          }

          if (DEBUG_MODE) {
            console.log(`Extracted ${pages.length} valid pages:`, pages);
          }

          // Get current page information for return
          const currentPageTitle =
            document
              .querySelector(
                '.container > div:nth-child(1) a[data-selected="true"]'
              )
              ?.textContent?.trim() ||
            document
              .querySelector(".container > div:nth-child(1) h1")
              ?.textContent?.trim() ||
            document.querySelector("h1")?.textContent?.trim() ||
            "Untitled";

          // Extract "Last indexed" date
          let lastIndexedDate = '';
          // Search for all p elements and find the one containing "Last indexed"
          const allParagraphs = document.querySelectorAll('p');
          for (const p of allParagraphs) {
            const text = p.textContent;
            if (text.includes('Last indexed:')) {
              const dateMatch = text.match(/Last indexed:\s*(\d{4}-\d{2}-\d{2})/);
              if (dateMatch) {
                lastIndexedDate = dateMatch[1].replace(/-/g, ''); // Format: 20251106
                break;
              }
            }
          }

          sendResponse({
            success: true,
            pages: pages,
            isDevinButtonNav: hostname.includes('devin.ai'),  // 告知 background.js 是否使用按鈕點擊式導覽
            currentTitle: currentPageTitle,
            baseUrl: baseUrl,
            headTitle: formattedHeadTitle,
            lastIndexedDate: lastIndexedDate
          });
        } catch (error) {
          console.error("Error extracting page links:", error);
          sendResponse({ success: false, error: error.message || 'Unknown error during extraction' });
        }
      }, 0);
    } else if (request.action === "pageLoaded") {
      // Page loading complete, batch operation preparation can be handled here
      // No sendResponse needed, as this is a notification from background.js
      if (DEBUG_MODE) console.log("Page loaded:", window.location.href);
      // Always send a response, even if empty, to avoid connection errors
      sendResponse({ received: true });
    } else if (request.action === "tabActivated") {
      // Tab has been activated, possibly after being in bfcache
      if (DEBUG_MODE) console.log("Tab activated:", window.location.href);
      // Acknowledge receipt of message to avoid connection errors
      sendResponse({ received: true });
    } else if (request.action === "navigateDevinPage") {
      // === Devin 批次下載的頁面切換 ===
      // 問題：Devin 是 SPA，用 chrome.tabs.update({ url }) 切換頁面會導致
      //       整個 app 重新導向到 wiki 首頁，無法正確載入目標頁面。
      // 解法：改為直接點擊側邊欄按鈕來切換頁面，並輪詢等待內容區塊更新。
      //       按鈕的篩選邏輯與 extractAllPages 完全相同，確保索引對應一致。
      const { buttonIndex } = request;
      if (DEBUG_MODE) console.log(`Devin: navigateDevinPage requested for buttonIndex=${buttonIndex}`);

      try {
        // Re-find sidebar buttons using same logic as extractAllPages
        let sidebarContainer = document.querySelector('div[class*="w-[--sidebar-main-width]"]');
        if (!sidebarContainer || sidebarContainer.querySelectorAll('button').length === 0) {
          const potentialContainers = Array.from(document.querySelectorAll('div, aside, nav'));
          sidebarContainer = potentialContainers.find(div => {
            const rect = div.getBoundingClientRect();
            if (rect.left > 100 || rect.width > 400 || rect.height < 300) return false;
            const btns = div.querySelectorAll('button');
            return btns.length >= 3;
          }) || null;
        }

        if (!sidebarContainer) {
          sendResponse({ success: false, error: 'Sidebar container not found' });
          return;
        }

        const buttons = Array.from(sidebarContainer.querySelectorAll('button'));

        // Extract Org Name for filtering (same logic as extractAllPages)
        const pathParts = window.location.pathname.split('/');
        const orgIndex = pathParts.indexOf('org');
        let orgName = '';
        if (orgIndex !== -1 && pathParts[orgIndex + 1]) {
          orgName = pathParts[orgIndex + 1].replace(/-/g, ' ');
        }

        const navButtons = buttons.filter(btn => {
          const text = btn.innerText.trim();
          if (!text) return false;
          if (['Add repo', 'New chat', 'Import repository', 'Create new'].some(exclude => text.includes(exclude))) return false;
          if (['Sessions', 'Ask', 'Wiki', 'Review', 'Settings', 'Back'].includes(text)) return false;
          return true;
        });

        const finalButtons = navButtons.filter(btn => {
          const text = btn.innerText.trim();
          if (orgName && text.toLowerCase().includes(orgName.toLowerCase())) return false;
          return true;
        });

        if (buttonIndex < 0 || buttonIndex >= finalButtons.length) {
          sendResponse({ success: false, error: `Button index ${buttonIndex} out of range (${finalButtons.length} buttons)` });
          return;
        }

        const targetButton = finalButtons[buttonIndex];
        if (DEBUG_MODE) console.log(`Devin: Clicking sidebar button "${targetButton.textContent.trim()}" at index ${buttonIndex}`);

        // Get the current content to detect when it changes
        const contentContainer =
          document.querySelector('.prose-main') ||
          document.querySelector('.prose') ||
          document.querySelector('article') ||
          document.querySelector('main');
        const previousContent = contentContainer ? contentContainer.innerHTML : '';

        // Click the button
        targetButton.click();

        // Wait for content to update (poll for change or timeout)
        const POLL_INTERVAL = 200;
        const MAX_WAIT = 10000;
        let waited = 0;

        const waitForContentChange = () => {
          const currentContainer =
            document.querySelector('.prose-main') ||
            document.querySelector('.prose') ||
            document.querySelector('article') ||
            document.querySelector('main');
          const currentContent = currentContainer ? currentContainer.innerHTML : '';

          if (currentContent !== previousContent || waited >= MAX_WAIT) {
            if (DEBUG_MODE) console.log(`Devin: Content updated after ${waited}ms`);
            sendResponse({ success: true });
            return;
          }

          waited += POLL_INTERVAL;
          setTimeout(waitForContentChange, POLL_INTERVAL);
        };

        // Give a small initial delay for the click to register
        setTimeout(waitForContentChange, POLL_INTERVAL);
      } catch (error) {
        console.error('Devin: navigateDevinPage error:', error);
        sendResponse({ success: false, error: error.message });
      }
      // Fall through to return true below (async sendResponse via setTimeout)
    }

    // Only return true for asynchronous actions that will call sendResponse later.
    // Note: convertToMarkdown already returns true inside its own if-block (line 146).
    if (request.action === "extractAllPages" || request.action === "navigateDevinPage") {
      return true;
    }
    // For synchronous actions (like pageLoaded, tabActivated), we already called sendResponse above
    return false;
  });

  // Helper: Extract lines of text from an element, handling tspans and other children
  function extractLinesFromTextElement(element) {
    const lines = [];
    let textExtractedFromChildren = false;

    element.childNodes.forEach(child => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tagName = child.tagName.toUpperCase();
        if (['TSPAN', 'DIV', 'P', 'SPAN'].includes(tagName)) {
          const t = child.textContent.trim();
          if (t) {
            lines.push(t);
            textExtractedFromChildren = true;
          }
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.trim();
        if (t) {
          lines.push(t);
          textExtractedFromChildren = true;
        }
      }
    });

    if (!textExtractedFromChildren) {
      const t = element.textContent.trim();
      if (t) lines.push(t);
    }
    return lines;
  }

  // === Mermaid 圖表原始碼擷取 ===
  // 背景：DeepWiki 和 Devin 都使用 Mermaid 渲染 SVG 圖表，但渲染後的 SVG DOM
  // 中不再包含原始的 Mermaid 語法。原始碼存放在 React fiber tree 的 memoizedProps 中。
  //
  // 架構：
  // 1. injectMermaidSourceExtractor() - 請求 background.js 在 MAIN world 執行擷取
  // 2. background.js 的 extractMermaidSources handler 負責實際的 fiber 遍歷
  //    - Pass 1: 從 SVG 父元素的 fiber 向上搜尋 mermaid 原始碼
  //    - Pass 2: 處理「孤兒」錯誤 SVG（被 Devin 渲染器拋到 body 下方，脫離 React tree）
  //    - Pass 3: 從 fiber props 擷取程式碼區塊的語言資訊
  // 3. 擷取結果寫入 data-mermaid-source / data-code-language DOM 屬性
  // 4. content.js 在轉換時讀取這些屬性（跨 world 共享 DOM）

  // 請求 background.js 執行 MAIN world 擷取腳本
  function injectMermaidSourceExtractor() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'extractMermaidSources' }, (response) => {
        if (chrome.runtime.lastError) {
          if (DEBUG_MODE) console.warn('Mermaid: extractMermaidSources failed:', chrome.runtime.lastError.message);
        } else if (DEBUG_MODE) {
          console.log('Mermaid: extractMermaidSources response:', response);
        }
        resolve();
      });
    });
  }

  // 從 data-mermaid-source 屬性讀取 mermaid 原始碼（由 MAIN world 腳本寫入）
  function extractMermaidSourceFromReact(svgElement) {
    const source = svgElement.getAttribute('data-mermaid-source');
    if (source && source.length > 10) {
      if (DEBUG_MODE) console.log('Mermaid: Found source from React fiber (main world extraction)');
      return source;
    }
    return null;
  }

  // 將 Mermaid SVG 元素轉換為 Mermaid 原始碼的 markdown 程式碼區塊
  // 策略優先順序：
  //   1. 從 data-mermaid-source 讀取（最佳品質，來自 React fiber）
  //   2. 從 SVG DOM 結構反向重建（品質較差，但不依賴 React）
  //   3. 擷取 SVG 中所有可見文字作為 fallback
  function convertMermaidSvgToSource(svgElement) {
    try {
      const ariaRole = svgElement.getAttribute('aria-roledescription') || '';

      // 錯誤圖表：Devin 的 mermaid 渲染器有時會產生 aria-roledescription="error" 的 SVG，
      // 這些 SVG 通常已脫離 React tree，但仍嘗試從 data attribute 讀取原始碼
      if (ariaRole === 'error') {
        const reactSource = extractMermaidSourceFromReact(svgElement);
        if (reactSource) {
          return `\n\`\`\`mermaid\n${reactSource}\n\`\`\`\n`;
        }
        if (DEBUG_MODE) console.log('Mermaid: Skipping error diagram (source lost)');
        return '\n\n> [Mermaid diagram - rendering failed on source page]\n\n';
      }

      // 策略 1：從 React fiber props 擷取原始碼（最佳品質）
      const reactSource = extractMermaidSourceFromReact(svgElement);
      if (reactSource) {
        return `\n\`\`\`mermaid\n${reactSource}\n\`\`\`\n`;
      }

      // 策略 2：從 SVG DOM 結構反向重建 mermaid 語法
      if (DEBUG_MODE) console.log('Mermaid: React source not found, falling back to SVG reconstruction');
      const svgClass = svgElement.getAttribute('class') || '';

      const isFlowchart = ariaRole.includes('flowchart') || svgClass.includes('flowchart');
      const isSequence = ariaRole.includes('sequence') || svgClass.includes('sequence');
      const isClassDiagram = svgClass.includes('classDiagram') || ariaRole.includes('classDiagram');

      if (isFlowchart) {
        return reconstructFlowchart(svgElement);
      } else if (isSequence) {
        return reconstructSequenceDiagram(svgElement);
      } else if (isClassDiagram) {
        return reconstructClassDiagram(svgElement);
      }

      // Fallback：擷取 SVG 中所有可見文字
      return mermaidFallback(svgElement);
    } catch (e) {
      if (DEBUG_MODE) console.warn('Mermaid SVG reconstruction failed:', e);
      return mermaidFallback(svgElement);
    }
  }

  function mermaidFallback(svgElement) {
    const texts = [];
    svgElement.querySelectorAll('span.nodeLabel, span.edgeLabel, text').forEach(el => {
      const t = el.textContent.trim();
      if (t) texts.push(t);
    });
    if (texts.length > 0) {
      return `\n\`\`\`\n[Mermaid diagram]\n${texts.join('\n')}\n\`\`\`\n`;
    }
    return '\n[Mermaid diagram - unable to reconstruct]\n';
  }

  // 跳脫 mermaid 標籤中的特殊字元：遇到 [](){}/<> 等字元時用雙引號包裹
  function escapeMermaidLabel(label) {
    if (/["\[\](){}/<>|\\#&;]/.test(label)) {
      // Double-quote the label, escaping inner quotes
      return '"' + label.replace(/"/g, '#quot;') + '"';
    }
    return label;
  }

  // === 流程圖 SVG → Mermaid 語法反向重建 ===
  // 從 SVG DOM 結構中擷取節點（g.node）、邊線（g.edgePaths path）、
  // 子圖（g.cluster）等資訊，重建為 flowchart 語法。
  // 節點 ID 格式：flowchart-{Name}-{N}，邊線 ID 格式：L_{Source}_{Target}_{N}
  function reconstructFlowchart(svgElement) {
    // 從 viewBox 寬高比推斷方向：寬 > 高 × 1.3 → LR，否則 TD
    const viewBox = svgElement.getAttribute('viewBox');
    let direction = 'TD';
    if (viewBox) {
      const parts = viewBox.split(/\s+/).map(Number);
      if (parts.length === 4) {
        const width = parts[2], height = parts[3];
        if (width > height * 1.3) direction = 'LR';
      }
    }

    const lines = [`flowchart ${direction}`];

    // Extract subgraphs with their DOM elements for containment checks
    const subgraphs = [];
    svgElement.querySelectorAll('g.cluster').forEach(cluster => {
      const labelEl = cluster.querySelector('foreignObject span, text');
      const label = labelEl ? labelEl.textContent.trim() : '';
      if (label) {
        subgraphs.push({ element: cluster, label });
      }
    });

    // Extract all nodes: id pattern "flowchart-{Name}-{N}"
    const allNodes = []; // { element, name, label }
    svgElement.querySelectorAll('g.node').forEach(node => {
      const nodeId = node.getAttribute('id') || '';
      const labelEl = node.querySelector('span.nodeLabel');
      const label = labelEl ? labelEl.textContent.trim() : '';

      let name = nodeId;
      const flowchartMatch = nodeId.match(/^flowchart-(.+)-\d+$/);
      if (flowchartMatch) {
        name = flowchartMatch[1];
      }

      if (name) {
        allNodes.push({ element: node, name, label: label || name });
      }
    });

    // Build a map of node name -> label for output
    const nodeMap = new Map();
    allNodes.forEach(n => nodeMap.set(n.name, n.label));

    // Determine which nodes belong to which subgraph (by DOM containment)
    const nodeToSubgraph = new Map(); // node name -> subgraph index
    allNodes.forEach(n => {
      for (let si = subgraphs.length - 1; si >= 0; si--) {
        if (subgraphs[si].element.contains(n.element)) {
          nodeToSubgraph.set(n.name, si);
          break; // Use innermost (last matched, since we iterate reverse)
        }
      }
    });

    // Extract edges from path IDs: "L_Source_Target_N" or "L-Source-Target-N"
    const edges = [];
    svgElement.querySelectorAll('g.edgePaths path, g.edgePath path').forEach(path => {
      const pathId = path.getAttribute('id') || '';
      const edgeMatch = pathId.match(/^L[-_](.+?)[-_](.+?)[-_]\d+$/);
      if (edgeMatch) {
        edges.push({ source: edgeMatch[1], target: edgeMatch[2], label: '' });
      }
    });

    // Extract edge labels by order (edgeLabels appear in same order as edges)
    const edgeLabelTexts = [];
    svgElement.querySelectorAll('g.edgeLabels > g').forEach(labelGroup => {
      const labelEl = labelGroup.querySelector('span.edgeLabel');
      const text = labelEl ? labelEl.textContent.trim() : '';
      edgeLabelTexts.push(text);
    });
    // Match by order
    edgeLabelTexts.forEach((text, i) => {
      if (text && edges[i]) {
        edges[i].label = text;
      }
    });

    // Output subgraphs with their contained nodes
    const nodesInSubgraphs = new Set();

    subgraphs.forEach((sg, si) => {
      lines.push(`  subgraph ${escapeMermaidLabel(sg.label)}`);
      allNodes.forEach(n => {
        if (nodeToSubgraph.get(n.name) === si) {
          lines.push(`    ${n.name}[${escapeMermaidLabel(n.label)}]`);
          nodesInSubgraphs.add(n.name);
        }
      });
      lines.push('  end');
    });

    // Output top-level nodes (not in any subgraph)
    allNodes.forEach(n => {
      if (!nodesInSubgraphs.has(n.name)) {
        lines.push(`  ${n.name}[${escapeMermaidLabel(n.label)}]`);
      }
    });

    // Output edges
    edges.forEach(edge => {
      if (edge.label) {
        lines.push(`  ${edge.source} -->|${escapeMermaidLabel(edge.label)}| ${edge.target}`);
      } else {
        lines.push(`  ${edge.source} --> ${edge.target}`);
      }
    });

    if (lines.length <= 1) {
      return mermaidFallback(svgElement);
    }

    return `\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n`;
  }

  function reconstructSequenceDiagram(svgElement) {
    const lines = ['sequenceDiagram'];

    // Extract actors/participants from text elements in actor boxes
    const actors = [];
    svgElement.querySelectorAll('g.actor, text.actor').forEach(el => {
      const text = el.textContent.trim();
      if (text && !actors.includes(text)) {
        actors.push(text);
        lines.push(`  participant ${text}`);
      }
    });

    // Extract messages from edge labels / message text
    svgElement.querySelectorAll('text.messageText, g.messageText text').forEach(el => {
      const text = el.textContent.trim();
      if (text) {
        // We can't perfectly reconstruct arrows, so use generic notation
        lines.push(`  Note over ${actors[0] || 'A'}: ${text}`);
      }
    });

    if (lines.length <= 1) {
      return mermaidFallback(svgElement);
    }

    return `\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n`;
  }

  function reconstructClassDiagram(svgElement) {
    const lines = ['classDiagram'];

    // Extract class names and members
    svgElement.querySelectorAll('g.classGroup').forEach(group => {
      const titleEl = group.querySelector('text.classTitle, tspan');
      const className = titleEl ? titleEl.textContent.trim() : '';
      if (className) {
        lines.push(`  class ${className}`);
      }
    });

    if (lines.length <= 1) {
      return mermaidFallback(svgElement);
    }

    return `\n\`\`\`mermaid\n${lines.join('\n')}\n\`\`\`\n`;
  }

  // Helper function to process a node and return Markdown
  function processNode(element) {
    let markdown = "";

    if (element.nodeType === Node.TEXT_NODE) {
      // Basic text cleanup
      let text = element.textContent.replace(/\u00A0/g, " "); // Replace non-breaking spaces
      if (text.trim().length > 0) {
        return text;
      }
      return "";
    }

    if (element.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    // Ignore hidden elements
    if (element.style.display === "none" || element.style.visibility === "hidden") {
      return "";
    }

    const tagName = element.tagName.toLowerCase();

    // Headers
    if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
      const level = parseInt(tagName.substring(1));
      const prefix = "#".repeat(level) + " ";
      let content = "";
      element.childNodes.forEach((child) => {
        // 過濾標題中的複製按鈕和 SVG 圖示
        // Devin 會在標題元素內部插入「Copied!」按鈕和剪貼簿 SVG 圖示，
        // 如果不過濾，輸出的 markdown 標題會附帶 "Copied!" 文字。
        if (child.nodeType === Node.ELEMENT_NODE) {
          const childTag = child.tagName.toLowerCase();
          if (childTag === 'button' || childTag === 'svg') return;
          if (child.getAttribute && child.getAttribute('aria-label')?.toLowerCase().includes('copy')) return;
        }
        content += processNode(child);
      });
      return `\n${prefix}${content.trim()}\n`;
    }

    // Paragraphs
    if (tagName === "p") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });
      content = content.trim();
      return content.length > 0 ? `\n${content}\n` : "";
    }

    // Lists
    if (tagName === "ul" || tagName === "ol") {
      let content = "";
      let index = 1;
      element.childNodes.forEach((child) => {
        if (child.tagName && child.tagName.toLowerCase() === "li") {
          let liContent = "";
          child.childNodes.forEach((grandChild) => {
            liContent += processNode(grandChild);
          });

          liContent = liContent.trim();
          // Handle nested lists by indenting? (Simple version: just ensure newlines)
          // For a robust MD, we'd need to pass depth.
          // For now, let's keep it simple.

          const prefix = tagName === "ul" ? "- " : `${index++}. `;
          content += `${prefix}${liContent}\n`;
        }
      });
      return `\n${content}\n`;
    }

    // === 表格轉換為 Markdown 表格 ===
    // 遞迴處理儲存格內容以保留行內格式（粗體、斜體、程式碼等），
    // 並跳脫管線符號 | 以避免破壞表格結構。
    if (tagName === "table") {
      const rows = element.querySelectorAll("tr");
      if (rows.length === 0) return "";

      const tableData = [];
      rows.forEach(row => {
        const cells = row.querySelectorAll("th, td");
        const rowData = [];
        cells.forEach(cell => {
          // Process cell content recursively to handle inline formatting
          let cellText = "";
          cell.childNodes.forEach(child => {
            cellText += processNode(child);
          });
          // Clean up: collapse whitespace, trim, escape pipes
          cellText = cellText.trim().replace(/\n/g, " ").replace(/\s+/g, " ").replace(/\|/g, "\\|");
          rowData.push(cellText);
        });
        tableData.push(rowData);
      });

      if (tableData.length === 0) return "";

      // Determine column count from the widest row
      const colCount = Math.max(...tableData.map(r => r.length));

      // Build markdown table
      let md = "\n";
      // Header row
      const header = tableData[0];
      md += "| " + header.map((c, i) => c || "").concat(Array(Math.max(0, colCount - header.length)).fill("")).join(" | ") + " |\n";
      // Separator
      md += "| " + Array(colCount).fill("---").join(" | ") + " |\n";
      // Data rows
      for (let i = 1; i < tableData.length; i++) {
        const row = tableData[i];
        md += "| " + row.map((c, j) => c || "").concat(Array(Math.max(0, colCount - row.length)).fill("")).join(" | ") + " |\n";
      }
      return md + "\n";
    }

    // 若直接遇到表格子元素（不經由 <table> 進入），仍遞迴處理其子節點
    if (["thead", "tbody", "tfoot", "tr", "th", "td"].includes(tagName)) {
      let content = "";
      element.childNodes.forEach(child => {
        content += processNode(child);
      });
      return content;
    }

    // Code Blocks (Pre/Code)
    if (tagName === "pre") {
      // DeepWiki 會將 mermaid SVG 包裹在 <pre> 元素中（DOM 結構：pre > div > svg），
      // 如果不在此處攔截，<pre> handler 會把 SVG 內的文字當作程式碼輸出。
      const mermaidSvg = element.querySelector('svg[id^="mermaid-"]');
      if (mermaidSvg) {
        return convertMermaidSvgToSource(mermaidSvg);
      }

      const codeElement = element.querySelector("code");
      let codeText = "";
      let language = "";

      if (codeElement) {
        codeText = codeElement.innerText; // Use innerText to preserve formatting
        // 程式語言偵測：優先從 CSS class (language-xxx) 取得，
        // 若無則從 data-code-language 屬性取得（由 MAIN world 腳本從 React fiber 擷取）
        const displayClass = Array.from(codeElement.classList).find(c => c.startsWith('language-'));
        if (displayClass) {
          language = displayClass.replace('language-', '');
        } else {
          language = codeElement.getAttribute('data-code-language') || '';
        }
      } else {
        codeText = element.innerText;
      }

      return `\n\`\`\`${language}\n${codeText}\n\`\`\`\n`;
    }

    // Inline Code
    if (tagName === "code") {
      // If parent is PRE, it's already handled.
      if (element.parentElement.tagName.toLowerCase() === 'pre') return "";
      return `\`${element.textContent}\``;
    }

    // Blockquotes
    if (tagName === "blockquote") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });
      return `\n> ${content.trim().replace(/\n/g, "\n> ")}\n`;
    }

    // Links
    if (tagName === "a") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });
      const href = element.getAttribute("href") || "";
      return `[${content}](${href})`;
    }

    // Images
    if (tagName === "img") {
      const alt = element.getAttribute("alt") || "";
      const src = element.getAttribute("src") || "";
      return `![${alt}](${src})`;
    }

    // Bold/Strong
    if (tagName === "strong" || tagName === "b") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });
      return `**${content}**`;
    }

    // Italic/Emphasis
    if (tagName === "em" || tagName === "i") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });
      return `*${content}*`;
    }

    // Horizontal Rule
    if (tagName === "hr") {
      return "\n---\n";
    }

    // === SVG 元素處理 ===
    // 偵測 Mermaid 圖表（id 以 mermaid- 開頭，或具有 flowchart/sequence 等 class/role），
    // 呼叫 convertMermaidSvgToSource 轉換為 mermaid 程式碼區塊。
    // 非 mermaid 的 SVG（圖示等）直接忽略，避免輸出無意義內容。
    if (tagName === 'svg') {
      const svgId = element.getAttribute('id') || '';
      const svgClass = element.getAttribute('class') || '';
      const ariaRole = element.getAttribute('aria-roledescription') || '';

      if (svgId.startsWith('mermaid-') ||
          ['flowchart', 'classDiagram', 'sequence'].some(t => svgClass.includes(t) || ariaRole.includes(t))) {
        return convertMermaidSvgToSource(element);
      }
      // Skip non-mermaid SVGs (icons, etc.)
      return '';
    }

    // Divs and Spans (Generic containers)
    if (tagName === "div" || tagName === "span" || tagName === "section" || tagName === "article" || tagName === "main") {
      let content = "";
      element.childNodes.forEach((child) => {
        content += processNode(child);
      });

      // If it's a block-level element like DIV, maybe add spacing?
      if (tagName === "div" || tagName === "section" || tagName === 'article') {
        return content ? `\n${content}\n` : "";
      }
      return content;
    }

    // Fallback: Just process children
    let content = "";
    element.childNodes.forEach((child) => {
      content += processNode(child);
    });
    return content;
  }
})();