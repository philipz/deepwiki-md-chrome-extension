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

            let items = [];
            let isNewDevinStructure = false;

            // Try New Devin Structure (March 2026+) first
            const menuButtons = Array.from(document.querySelectorAll('div[data-slot="sidebar-menu-button"]'));
            if (menuButtons.length > 0) {
              isNewDevinStructure = true;
              items = menuButtons;
              if (DEBUG_MODE) console.log('Devin: Found sidebar via data-slot="sidebar-menu-button" heuristic');
            } else {
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
                items = Array.from(sidebarContainer.querySelectorAll('button'));
              }
            }

            // We use `isNewDevinStructure || sidebarContainer` to replace the old `if (sidebarContainer)` check cleanly.
            if (isNewDevinStructure || sidebarContainer) {
              if (items.length > 0) {
                let counters = [];

                // Filter items that are likely nav items
                const navButtons = items.filter(item => {
                  let text = '';
                  if (isNewDevinStructure) {
                    const btn = item.querySelector('button');
                    text = btn ? (btn.getAttribute('aria-label') || btn.innerText.trim()) : '';
                    if (!text) {
                      const span = item.querySelector('span.truncate');
                      if (span) text = span.textContent.trim();
                    }
                  } else {
                    text = item.innerText.trim();
                  }

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
                const finalButtons = navButtons.filter(item => {
                  let text = '';
                  if (isNewDevinStructure) {
                    const btn = item.querySelector('button');
                    text = btn ? (btn.getAttribute('aria-label') || btn.innerText.trim()) : '';
                    if (!text) {
                      const span = item.querySelector('span.truncate');
                      if (span) text = span.textContent.trim();
                    }
                  } else {
                    text = item.innerText.trim();
                  }

                  if (orgName && text.toLowerCase().includes(orgName.toLowerCase())) return false;
                  return true;
                });

                finalButtons.forEach(item => {
                  let text = '';
                  if (isNewDevinStructure) {
                    const btn = item.querySelector('button');
                    text = btn ? (btn.getAttribute('aria-label') || btn.innerText.trim()) : '';
                    if (!text) {
                      const span = item.querySelector('span.truncate');
                      if (span) text = span.textContent.trim();
                    }
                  } else {
                    text = item.textContent.trim();
                  }

                  const rect = item.getBoundingClientRect();

                  // Store raw data for processing
                  counters.push({
                    element: item,
                    text: text,
                    left: rect.left
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
                      hierarchicalTitle: `${prefix} ${item.text}`
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
              selected: link.getAttribute('data-selected') === 'true'
            };
          });

          // Filter out pages that strictly don't belong to the current project path
          // For Devin, we calculate a Wiki Base URL (project root) and should filter by that.
          // For generic sites, we might stick to currentPathPrefix but it's risky for siblings.

          let filterPrefix = window.location.origin + window.location.pathname;

          // If we are on Devin and detected a wiki base, use it
          if (hostname.includes('devin.ai')) {
            const pathParts = window.location.pathname.split('/');
            const wikiIndex = pathParts.indexOf('wiki');
            // Capture up to project name: /org/[org]/wiki/[user]/[project]
            if (wikiIndex !== -1 && pathParts[wikiIndex + 2]) {
              const basePath = pathParts.slice(0, wikiIndex + 3).join('/');
              filterPrefix = window.location.origin + basePath;
            }
          }

          pages = pages.filter(page => page.url.startsWith(filterPrefix));

          if (DEBUG_MODE) {
            console.log(`Extracted ${pages.length} valid pages (Prefix: ${filterPrefix}):`, pages);
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
    }

    // Only return true for asynchronous actions that will call sendResponse later.
    // Note: convertToMarkdown already returns true inside its own if-block (line 146).
    if (request.action === "extractAllPages") {
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

    // Code Blocks (Pre/Code)
    if (tagName === "pre") {
      const codeElement = element.querySelector("code");
      let codeText = "";
      let language = "";

      if (codeElement) {
        codeText = codeElement.innerText; // Use innerText to preserve formatting
        // Try to get language class
        const displayClass = Array.from(codeElement.classList).find(c => c.startsWith('language-'));
        if (displayClass) language = displayClass.replace('language-', '');
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