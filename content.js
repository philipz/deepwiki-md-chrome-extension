// Debug flag to control verbose logging (set to false in production)
// Debug flag is now loaded from utils.js

// Security check: Only allow local file access in debug mode or for test pages
const ALLOW_SCRIPT_EXECUTION = (function () {
  const currentUrl = window.location.href;
  const isLocalFile = currentUrl.startsWith('file://');

  if (!isLocalFile) {
    // Always allow on non-local files (e.g., https://deepwiki.com)
    return true;
  }

  // Check if it's a test page
  const isTestPage = currentUrl.includes('test-page.html') || currentUrl.includes('/test/');

  if (isTestPage) {
    // Always allow test pages
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

// Early exit if script execution is not allowed
if (!ALLOW_SCRIPT_EXECUTION) {
  // Do nothing - silently skip execution
  chrome.runtime.onMessage.addListener(() => {
    // Respond to prevent "Receiving end does not exist" errors
    return false;
  });
} else {

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "convertToMarkdown") {
      try {
        // Get page title from head
        const headTitle = document.title || "";
        // Format head title: replace slashes and pipes with dashes
        const formattedHeadTitle = headTitle.replace(/[\/|]/g, '-').replace(/\s+/g, '-').replace('---', '-');

        // Get article title (keep unchanged)
        const title =
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

        // Get article content container (keep unchanged)
        const contentContainer =
          document.querySelector(".container > div:nth-child(2) .prose") ||
          document.querySelector(".container > div:nth-child(2) .prose-custom") ||
          document.querySelector(".container > div:nth-child(2)") ||
          document.body;

        let markdown = ``;
        let markdownTitle = title.replace(/\s+/g, '-');

        contentContainer.childNodes.forEach((child) => {
          markdown += processNode(child);
        });

        // Normalize blank lines
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
    } else if (request.action === "extractAllPages") {
      try {
        // Get the head title
        const headTitle = document.title || "";
        // Format head title: replace slashes and pipes with dashes
        const formattedHeadTitle = headTitle.replace(/[\/|]/g, '-').replace(/\s+/g, '-').replace('---', '-');

        // Get the base part of the current document path
        const baseUrl = window.location.origin;

        // Get all links in the sidebar
        const sidebarLinks = Array.from(document.querySelectorAll('.border-r-border ul li a'));

        // Extract link URLs and titles
        const pages = sidebarLinks.map(link => {
          return {
            url: new URL(link.getAttribute('href'), baseUrl).href,
            title: link.textContent.trim(),
            selected: link.getAttribute('data-selected') === 'true'
          };
        });

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
        sendResponse({ success: false, error: error.message });
      }
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
    // Always return true for asynchronous sendResponse handling
    return true;
  });
  // Helper: Convert Flowchart SVG to Mermaid text (Index-Based Matching)
  function convertFlowchartSvgToMermaidText(svgElement) {
    if (!svgElement) return null;

    if (DEBUG_MODE) console.log("Converting flowchart SVG to Mermaid with Index-Based Matching...");
    let mermaidCode = "flowchart TD\n\n";
    const nodes = {};
    const clusters = {};
    const parentMap = {}; // Maps a child SVG ID to its parent SVG ID
    const allElements = {}; // All nodes and clusters, for easy lookup

    // 1. Collect all nodes
    // Expanded selectors: g.node is standard, but some versions use g.default or just IDs
    const nodeCandidates = Array.from(svgElement.querySelectorAll('g.node, g.default, g[id^="flowchart-"], g[id^="mermaid-"]'));

    nodeCandidates.forEach(nodeEl => {
      // Filter out non-nodes (edges, clusters, labels) if they got caught by ID selectors
      if (nodeEl.classList.contains('edgePath') ||
        nodeEl.classList.contains('cluster') ||
        nodeEl.classList.contains('label') ||
        nodeEl.classList.contains('edgeLabel')) {
        return;
      }

      const svgId = nodeEl.id;
      if (!svgId) return;

      let textContent = "";
      const pElementForText = nodeEl.querySelector('.label foreignObject div > span > p, .label foreignObject div > p');
      if (pElementForText) {
        let rawParts = [];
        pElementForText.childNodes.forEach(child => {
          if (child.nodeType === Node.TEXT_NODE) rawParts.push(child.textContent);
          else if (child.nodeName.toUpperCase() === 'BR') rawParts.push('<br>');
          else if (child.nodeType === Node.ELEMENT_NODE) rawParts.push(child.textContent || '');
        });
        textContent = rawParts.join('').trim().replace(/"/g, '#quot;');
      }
      if (!textContent.trim()) {
        const nodeLabel = nodeEl.querySelector('.nodeLabel, .label, foreignObject span, foreignObject div, text');
        if (nodeLabel && nodeLabel.textContent) {
          textContent = nodeLabel.textContent.trim().replace(/"/g, '#quot;');
        }
      }

      // Normalize ID: flowchart-orders-3 -> orders
      let mermaidId = svgId.replace(/^flowchart-/, '').replace(/-\d+$/, '');

      // Handle potential ID conflicts or complex IDs if necessary
      // For now, assuming the simplified ID matches the path references

      const bbox = nodeEl.getBoundingClientRect();
      if (bbox.width > 0 || bbox.height > 0) {
        nodes[svgId] = {
          type: 'node',
          mermaidId: mermaidId,
          text: textContent,
          svgId: svgId,
          bbox: bbox,
        };
        allElements[svgId] = nodes[svgId];
      }
    });

    // 2. Collect all clusters
    svgElement.querySelectorAll('g.cluster').forEach(clusterEl => {
      const svgId = clusterEl.id;
      if (!svgId) return;

      let title = "";
      const labelEl = clusterEl.querySelector('.cluster-label, .label');
      if (labelEl && labelEl.textContent) {
        title = labelEl.textContent.trim();
      }
      if (!title) {
        title = svgId;
      }

      const rect = clusterEl.querySelector('rect');
      const bbox = rect ? rect.getBoundingClientRect() : clusterEl.getBoundingClientRect();

      if (bbox.width > 0 || bbox.height > 0) {
        clusters[svgId] = {
          type: 'cluster',
          mermaidId: svgId, // Use stable SVG ID for mermaid ID
          title: title,
          svgId: svgId,
          bbox: bbox,
        };
        allElements[svgId] = clusters[svgId];
      }
    });

    // 3. Build hierarchy (parentMap) by checking for geometric containment
    for (const childId in allElements) {
      const child = allElements[childId];
      let potentialParentId = null;
      let minArea = Infinity;

      for (const parentId in clusters) {
        if (childId === parentId) continue;
        const parent = clusters[parentId];

        if (child.bbox.left >= parent.bbox.left &&
          child.bbox.right <= parent.bbox.right &&
          child.bbox.top >= parent.bbox.top &&
          child.bbox.bottom <= parent.bbox.bottom) {

          const area = parent.bbox.width * parent.bbox.height;
          if (area < minArea) {
            minArea = area;
            potentialParentId = parentId;
          }
        }
      }
      if (potentialParentId) {
        parentMap[childId] = potentialParentId;
      }
    }

    // 4. Process edges and labels using Geometric Matching (Nearest Neighbor)
    const edges = [];

    // Expanded selectors for edges to support flowchart-v2 and other variants
    const pathElements = Array.from(svgElement.querySelectorAll('path.flowchart-link, g.edgePath > path, g.edgePaths > path, path.edge-thickness-normal, path[marker-end]'));
    const labelElements = Array.from(svgElement.querySelectorAll('g.edgeLabel, g.edgeLabels > g.edgeLabel'));

    if (DEBUG_MODE) {
      console.log(`[Mermaid Debug] Found ${pathElements.length} paths and ${labelElements.length} labels.`);
      console.log(`[Mermaid Debug] Known nodes:`, Object.keys(nodes));
    }

    // Helper to get center of an element
    function getCenter(bbox) {
      return {
        x: bbox.x + bbox.width / 2,
        y: bbox.y + bbox.height / 2
      };
    }

    // Helper to get distance between two points
    function getDistance(p1, p2) {
      return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    }

    // Helper to get distance from a point to a box (node)
    function getDistanceToBox(px, py, bbox) {
      const dx = Math.max(bbox.left - px, 0, px - bbox.right);
      const dy = Math.max(bbox.top - py, 0, py - bbox.bottom);
      return Math.sqrt(dx * dx + dy * dy);
    }

    // Map labels to their centers
    const labelData = labelElements.map(labelEl => {
      const bbox = labelEl.getBoundingClientRect();
      // Extract text content
      let labelText = "";
      const foreignObj = labelEl.querySelector('foreignObject span, foreignObject div, foreignObject p');
      if (foreignObj) {
        labelText = foreignObj.textContent?.trim();
      } else {
        labelText = labelEl.textContent?.trim();
      }
      return {
        element: labelEl,
        center: getCenter(bbox),
        text: labelText,
        matched: false
      };
    });

    // Process each path
    pathElements.forEach((path, index) => {
      const pathId = path.id;

      let sourceId = null;
      let targetId = null;

      // --- Strategy 1: ID Parsing (Legacy & Standard) ---
      if (pathId) {
        // L_ format (L_source_target_index)
        let match = pathId.match(/^L_([^_]+)_(.+)_\d+$/);
        if (match) {
          sourceId = match[1];
          targetId = match[2];
        }

        // flowchart- format (flowchart-source-target-index)
        if (!sourceId) {
          match = pathId.match(/^flowchart-([^-]+)-([^-]+)-\d+$/);
          if (match) {
            sourceId = match[1];
            targetId = match[2];
          }
        }

        // Robust Fallback (Split and Match)
        if (!sourceId || !targetId) {
          let core = pathId.replace(/^(L_|flowchart-)/, '').replace(/[-_]\d+$/, '');
          // Try to split at every possible point
          for (let j = 1; j < core.length; j++) {
            const charAtJ = core[j];
            if (charAtJ === '-' || charAtJ === '_') {
              const s_clean = core.substring(0, j);
              const t_clean = core.substring(j + 1);
              const sourceNode = Object.values(nodes).find(n => n.mermaidId === s_clean);
              const targetNode = Object.values(nodes).find(n => n.mermaidId === t_clean);
              if (sourceNode && targetNode) {
                sourceId = s_clean;
                targetId = t_clean;
                break;
              }
            }
          }
        }
      }

      // --- Strategy 2: Geometric Matching (Fallback for flowchart-v2 / missing IDs) ---
      if (!sourceId || !targetId) {
        // Always try geometric matching if ID parsing failed
        try {
          const svg = svgElement.closest('svg') || svgElement;
          const ptStart = svg.createSVGPoint();
          const ptEnd = svg.createSVGPoint();

          const totalLength = path.getTotalLength();
          // Use a small offset for start/end to avoid being exactly on the boundary if that matters,
          // but usually 0 and totalLength are best.
          const startPointLocal = path.getPointAtLength(0);
          const endPointLocal = path.getPointAtLength(totalLength);

          ptStart.x = startPointLocal.x;
          ptStart.y = startPointLocal.y;
          ptEnd.x = endPointLocal.x;
          ptEnd.y = endPointLocal.y;

          // Transform to screen coordinates
          const globalCTM = path.getScreenCTM();
          const startPoint = ptStart.matrixTransform(globalCTM);
          const endPoint = ptEnd.matrixTransform(globalCTM);

          // Find nearest nodes
          let minStartDist = Infinity;
          let minEndDist = Infinity;
          let nearestSource = null;
          let nearestTarget = null;

          // Log coordinates for debugging
          if (DEBUG_MODE) {
            console.log(`[Mermaid Debug] Path ${index} coords: Start(${Math.round(startPoint.x)},${Math.round(startPoint.y)}), End(${Math.round(endPoint.x)},${Math.round(endPoint.y)})`);
          }

          Object.values(nodes).forEach(node => {
            const bbox = node.bbox;

            // Use distance to the nearest point on the box (more accurate for large nodes)
            const startDist = getDistanceToBox(startPoint.x, startPoint.y, bbox);
            const endDist = getDistanceToBox(endPoint.x, endPoint.y, bbox);

            if (startDist < minStartDist) {
              minStartDist = startDist;
              nearestSource = node;
            }
            if (endDist < minEndDist) {
              minEndDist = endDist;
              nearestTarget = node;
            }
          });

          // Threshold check (e.g. 200px is generous but safe for most diagrams)
          const MAX_DISTANCE_THRESHOLD = 200;

          if (DEBUG_MODE) {
            console.log(`[Mermaid Debug] Path ${index} Nearest: Source=${nearestSource?.mermaidId} (${Math.round(minStartDist)}px), Target=${nearestTarget?.mermaidId} (${Math.round(minEndDist)}px)`);
          }

          if (minStartDist < MAX_DISTANCE_THRESHOLD && minEndDist < MAX_DISTANCE_THRESHOLD) {
            sourceId = nearestSource.mermaidId;
            targetId = nearestTarget.mermaidId;
            if (DEBUG_MODE) console.debug(`[Mermaid Debug] Path ${index} Geometric Match: Source=${sourceId} (${Math.round(minStartDist)}px), Target=${targetId} (${Math.round(minEndDist)}px)`);
          } else {
            if (DEBUG_MODE) console.debug(`[Mermaid Debug] Path ${index} Geometric Match Failed: Distances too large. Source=${Math.round(minStartDist)}px, Target=${Math.round(minEndDist)}px`);
          }

        } catch (e) {
          if (DEBUG_MODE) console.debug(`[Mermaid Debug] Geometric matching failed for path ${index}:`, e);
        }
      }


      if (!sourceId || !targetId) {
        if (DEBUG_MODE) {
          console.debug(`[Mermaid Debug] Could not parse source/target from path:`, path);
        }
        return;
      }

      const sourceNode = Object.values(nodes).find(n => n.mermaidId === sourceId) || Object.values(clusters).find(c => c.mermaidId === sourceId);
      const targetNode = Object.values(nodes).find(n => n.mermaidId === targetId) || Object.values(clusters).find(c => c.mermaidId === targetId);

      if (!sourceNode || !targetNode) {
        if (DEBUG_MODE) console.debug(`[Mermaid Debug] Matched IDs but nodes not found: Source=${sourceId}, Target=${targetId}`);
        return;
      }

      // --- Label Matching Logic ---
      let matchedLabelText = "";

      // Find the closest label to this path
      // We use the path's bounding box center as a proxy for the path's position
      const pathBBox = path.getBoundingClientRect();
      const pathCenter = getCenter(pathBBox);

      let closestLabel = null;
      let minDistance = Infinity;
      const MAX_DISTANCE_THRESHOLD = 150; // Pixels, relaxed

      labelData.forEach(label => {
        if (label.matched) return; // Skip already matched labels (optional, but good for 1-to-1)

        const dist = getDistance(pathCenter, label.center);
        if (dist < minDistance && dist < MAX_DISTANCE_THRESHOLD) {
          minDistance = dist;
          closestLabel = label;
        }
      });

      if (closestLabel) {
        matchedLabelText = closestLabel.text;
        closestLabel.matched = true; // Mark as matched
      }

      // Determine Arrow Type
      const isDashed = path.classList.contains('dashed') || path.classList.contains('dotted') ||
        getComputedStyle(path).strokeDasharray !== 'none'; // Check computed style too
      const arrow = isDashed ? "-.->" : "-->";

      const labelPart = matchedLabelText ? `|"${matchedLabelText}"|` : "";
      const edgeText = `${sourceNode.mermaidId} ${arrow}${labelPart} ${targetNode.mermaidId}`;

      // Determine Parent (LCA)
      const sourceAncestors = [parentMap[sourceNode.svgId]];
      while (sourceAncestors[sourceAncestors.length - 1]) {
        sourceAncestors.push(parentMap[sourceAncestors[sourceAncestors.length - 1]]);
      }
      let lca = parentMap[targetNode.svgId];
      while (lca && !sourceAncestors.includes(lca)) {
        lca = parentMap[lca];
      }

      edges.push({ text: edgeText, parentId: lca || 'root' });
    });

    // 5. Generate Mermaid output
    const definedNodeMermaidIds = new Set();
    for (const svgId in nodes) {
      const node = nodes[svgId];
      if (!definedNodeMermaidIds.has(node.mermaidId)) {
        mermaidCode += `${node.mermaidId}["${node.text}"]\n`;
        definedNodeMermaidIds.add(node.mermaidId);
      }
    }
    mermaidCode += '\n';

    // Group children and edges by parent
    const childrenMap = {};
    const edgeMap = {};

    for (const childId in parentMap) {
      const parentId = parentMap[childId];
      if (!childrenMap[parentId]) childrenMap[parentId] = [];
      childrenMap[parentId].push(childId);
    }

    edges.forEach(edge => {
      const parentId = edge.parentId || 'root';
      if (!edgeMap[parentId]) edgeMap[parentId] = [];
      edgeMap[parentId].push(edge.text);
    });

    // Add top-level edges
    (edgeMap['root'] || []).forEach(edgeText => {
      mermaidCode += `${edgeText}\n`;
    });

    function buildSubgraphOutput(clusterId) {
      const cluster = clusters[clusterId];
      if (!cluster) return;

      mermaidCode += `\nsubgraph ${cluster.mermaidId} ["${cluster.title}"]\n`;

      const childItems = childrenMap[clusterId] || [];

      // Render nodes within this subgraph
      childItems.filter(id => nodes[id]).forEach(nodeId => {
        mermaidCode += `    ${nodes[nodeId].mermaidId}\n`;
      });

      // Render edges within this subgraph
      (edgeMap[clusterId] || []).forEach(edgeText => {
        mermaidCode += `    ${edgeText}\n`;
      });

      // Render nested subgraphs
      childItems.filter(id => clusters[id]).forEach(subClusterId => {
        buildSubgraphOutput(subClusterId);
      });

      mermaidCode += "end\n";
    }

    const topLevelClusters = Object.keys(clusters).filter(id => !parentMap[id]);
    topLevelClusters.forEach(buildSubgraphOutput);

    if (Object.keys(nodes).length === 0 && Object.keys(clusters).length === 0) return null;
    return '```mermaid\n' + mermaidCode.trim() + '\n```';
  }

  // Function for Class Diagram (ensure this exists from previous responses)
  function convertClassDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;
    const mermaidLines = ['classDiagram'];
    const classData = {};

    // 1. Parse Classes and their geometric information
    svgElement.querySelectorAll('g.node.default[id^="classId-"]').forEach(node => {
      const classIdSvg = node.getAttribute('id');
      if (!classIdSvg) return;

      const classNameMatch = classIdSvg.match(/^classId-([^-]+(?:-[^-]+)*)-(\d+)$/);
      if (!classNameMatch) return;
      const className = classNameMatch[1];

      let cx = 0, cy = 0, halfWidth = 0, halfHeight = 0;
      const transform = node.getAttribute('transform');
      if (transform) {
        const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (match) {
          cx = parseFloat(match[1]);
          cy = parseFloat(match[2]);
        }
      }
      const pathForBounds = node.querySelector('g.basic.label-container > path[d^="M-"]');
      if (pathForBounds) {
        const d = pathForBounds.getAttribute('d');
        const dMatch = d.match(/M-([0-9.]+)\s+-([0-9.]+)/); // Extracts W and H from M-W -H
        if (dMatch && dMatch.length >= 3) {
          halfWidth = parseFloat(dMatch[1]);
          halfHeight = parseFloat(dMatch[2]);
        }
      }

      if (!classData[className]) {
        classData[className] = {
          stereotype: "",
          members: [],
          methods: [],
          svgId: classIdSvg,
          x: cx,
          y: cy,
          width: halfWidth * 2,
          height: halfHeight * 2
        };
      }
      const stereotypeElem = node.querySelector('g.annotation-group.text foreignObject span.nodeLabel p, g.annotation-group.text foreignObject div p');
      if (stereotypeElem && stereotypeElem.textContent.trim()) {
        classData[className].stereotype = stereotypeElem.textContent.trim();
      }
      node.querySelectorAll('g.members-group.text g.label foreignObject span.nodeLabel p, g.members-group.text g.label foreignObject div p').forEach(m => {
        const txt = m.textContent.trim();
        if (txt) classData[className].members.push(txt);
      });
      node.querySelectorAll('g.methods-group.text g.label foreignObject span.nodeLabel p, g.methods-group.text g.label foreignObject div p').forEach(m => {
        const txt = m.textContent.trim();
        if (txt) classData[className].methods.push(txt);
      });
    });

    // 2. Parse Notes
    const notes = [];

    // Method 1: Find traditional rect.note and text.noteText
    svgElement.querySelectorAll('g').forEach(g => {
      const noteRect = g.querySelector('rect.note');
      const noteText = g.querySelector('text.noteText');

      if (noteRect && noteText) {
        const text = noteText.textContent.trim();
        const x = parseFloat(noteRect.getAttribute('x'));
        const y = parseFloat(noteRect.getAttribute('y'));
        const width = parseFloat(noteRect.getAttribute('width'));
        const height = parseFloat(noteRect.getAttribute('height'));

        if (text && !isNaN(x) && !isNaN(y)) {
          notes.push({
            text: text,
            x: x,
            y: y,
            width: width || 0,
            height: height || 0,
            id: g.id || `note_${notes.length}`
          });
        }
      }
    });

    // Method 2: Find other note formats (like node undefined type)
    svgElement.querySelectorAll('g.node.undefined, g[id^="note"]').forEach(g => {
      // Check if it's a note (by background color, id or other features)
      const hasNoteBackground = g.querySelector('path[fill="#fff5ad"], path[style*="#fff5ad"], path[style*="fill:#fff5ad"]');
      const isNoteId = g.id && g.id.includes('note');

      if (hasNoteBackground || isNoteId) {
        // Try to get text from foreignObject
        let text = '';
        const foreignObject = g.querySelector('foreignObject');
        if (foreignObject) {
          const textEl = foreignObject.querySelector('p, span.nodeLabel, .nodeLabel');
          if (textEl) {
            text = textEl.textContent.trim();
          }
        }

        // If no text found, try other selectors
        if (!text) {
          const textEl = g.querySelector('text, .label text, tspan');
          if (textEl) {
            text = textEl.textContent.trim();
          }
        }

        if (text) {
          // Get position information
          const transform = g.getAttribute('transform');
          let x = 0, y = 0;
          if (transform) {
            const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
            if (match) {
              x = parseFloat(match[1]);
              y = parseFloat(match[2]);
            }
          }

          // Check if this note has already been added
          const existingNote = notes.find(n => n.text === text && Math.abs(n.x - x) < 10 && Math.abs(n.y - y) < 10);
          if (!existingNote) {
            notes.push({
              text: text,
              x: x,
              y: y,
              width: 0,
              height: 0,
              id: g.id || `note_${notes.length}`
            });
          }
        }
      }
    });

    // 3. Parse Note-to-Class Connections
    const noteTargets = {}; // Maps note.id to target className
    const connectionThreshold = 50; // Increase connection threshold

    // Find note connection paths, support multiple path types
    const noteConnections = [
      ...svgElement.querySelectorAll('path.relation.edge-pattern-dotted'),
      ...svgElement.querySelectorAll('path[id^="edgeNote"]'),
      ...svgElement.querySelectorAll('path.edge-thickness-normal.edge-pattern-dotted')
    ];

    noteConnections.forEach(pathEl => {
      const dAttr = pathEl.getAttribute('d');
      if (!dAttr) return;

      // Improved path parsing, support Bezier curves
      const pathPoints = [];

      // Parse various path commands
      const commands = dAttr.match(/[A-Za-z][^A-Za-z]*/g) || [];
      let currentX = 0, currentY = 0;

      commands.forEach(cmd => {
        const parts = cmd.match(/[A-Za-z]|[-+]?\d*\.?\d+/g) || [];
        const type = parts[0];
        const coords = parts.slice(1).map(Number);

        switch (type.toUpperCase()) {
          case 'M': // Move to
            if (coords.length >= 2) {
              currentX = coords[0];
              currentY = coords[1];
              pathPoints.push({ x: currentX, y: currentY });
            }
            break;
          case 'L': // Line to
            for (let i = 0; i < coords.length; i += 2) {
              if (coords[i + 1] !== undefined) {
                currentX = coords[i];
                currentY = coords[i + 1];
                pathPoints.push({ x: currentX, y: currentY });
              }
            }
            break;
          case 'C': // Cubic bezier
            for (let i = 0; i < coords.length; i += 6) {
              if (coords[i + 5] !== undefined) {
                // Get end point coordinates
                currentX = coords[i + 4];
                currentY = coords[i + 5];
                pathPoints.push({ x: currentX, y: currentY });
              }
            }
            break;
          case 'Q': // Quadratic bezier
            for (let i = 0; i < coords.length; i += 4) {
              if (coords[i + 3] !== undefined) {
                currentX = coords[i + 2];
                currentY = coords[i + 3];
                pathPoints.push({ x: currentX, y: currentY });
              }
            }
            break;
        }
      });

      if (pathPoints.length < 2) return;

      const pathStart = pathPoints[0];
      const pathEnd = pathPoints[pathPoints.length - 1];

      // Find the closest note to path start point
      let closestNote = null;
      let minDistToNote = Infinity;
      notes.forEach(note => {
        const dist = Math.sqrt(Math.pow(note.x - pathStart.x, 2) + Math.pow(note.y - pathStart.y, 2));
        if (dist < minDistToNote) {
          minDistToNote = dist;
          closestNote = note;
        }
      });

      // Find the closest class to path end point
      let targetClassName = null;
      let minDistToClass = Infinity;
      for (const currentClassName in classData) {
        const classInfo = classData[currentClassName];
        const classCenterX = classInfo.x;
        const classCenterY = classInfo.y;
        const classWidth = classInfo.width || 200; // Default width
        const classHeight = classInfo.height || 200; // Default height

        // Calculate distance from path end to class center
        const distToCenter = Math.sqrt(
          Math.pow(pathEnd.x - classCenterX, 2) +
          Math.pow(pathEnd.y - classCenterY, 2)
        );

        // Also calculate distance to class boundary
        const classLeft = classCenterX - classWidth / 2;
        const classRight = classCenterX + classWidth / 2;
        const classTop = classCenterY - classHeight / 2;
        const classBottom = classCenterY + classHeight / 2;

        const dx = Math.max(classLeft - pathEnd.x, 0, pathEnd.x - classRight);
        const dy = Math.max(classTop - pathEnd.y, 0, pathEnd.y - classBottom);
        const distToEdge = Math.sqrt(dx * dx + dy * dy);

        // Use the smaller distance as the judgment criterion
        const finalDist = Math.min(distToCenter, distToEdge + classWidth / 4);

        if (finalDist < minDistToClass) {
          minDistToClass = finalDist;
          targetClassName = currentClassName;
        }
      }

      // Relax connection conditions
      if (closestNote && targetClassName &&
        minDistToNote < connectionThreshold &&
        minDistToClass < connectionThreshold * 2) {

        const existing = noteTargets[closestNote.id];
        const currentScore = minDistToNote + minDistToClass;

        if (!existing || currentScore < existing.score) {
          noteTargets[closestNote.id] = {
            name: targetClassName,
            score: currentScore,
            noteDistance: minDistToNote,
            classDistance: minDistToClass
          };
        }
      }
    });

    // 4. Add Note Definitions to Mermaid output
    const noteMermaidLines = [];
    notes.forEach(note => {
      const targetInfo = noteTargets[note.id];
      if (targetInfo && targetInfo.name) {
        noteMermaidLines.push(`    note for ${targetInfo.name} "${note.text}"`);
      } else {
        noteMermaidLines.push(`    note "${note.text}"`);
      }
    });
    // Insert notes after 'classDiagram' line
    if (noteMermaidLines.length > 0) {
      mermaidLines.splice(1, 0, ...noteMermaidLines);
    }

    // 5. Add Class Definitions
    for (const className in classData) {
      const data = classData[className];
      if (data.stereotype) {
        mermaidLines.push(`    class ${className} {`);
        mermaidLines.push(`        ${data.stereotype}`);
      } else {
        mermaidLines.push(`    class ${className} {`);
      }
      data.members.forEach(member => { mermaidLines.push(`        ${member}`); });
      data.methods.forEach(method => { mermaidLines.push(`        ${method}`); });
      mermaidLines.push('    }');
    }

    const pathElements = Array.from(svgElement.querySelectorAll('path.relation[id^="id_"]'));
    const labelElements = Array.from(svgElement.querySelectorAll('g.edgeLabels .edgeLabel foreignObject p'));

    pathElements.forEach((path, index) => {
      const id = path.getAttribute('id');
      if (!id || !id.startsWith('id_')) return;

      // Remove 'id_' prefix and trailing number (e.g., '_1')
      let namePart = id.substring(3).replace(/_\d+$/, '');

      const idParts = namePart.split('_');
      let fromClass = null;
      let toClass = null;

      // Iterate through possible split points to find valid class names
      for (let i = 1; i < idParts.length; i++) {
        const potentialFrom = idParts.slice(0, i).join('_');
        const potentialTo = idParts.slice(i).join('_');

        if (classData[potentialFrom] && classData[potentialTo]) {
          fromClass = potentialFrom;
          toClass = potentialTo;
          break; // Found a valid pair
        }
      }

      if (!fromClass || !toClass) {
        console.error("Could not parse class relation from ID:", id);
        return; // Skip if we couldn't parse
      }

      // Get key attributes
      const markerEndAttr = path.getAttribute('marker-end') || "";
      const markerStartAttr = path.getAttribute('marker-start') || "";
      const pathClass = path.getAttribute('class') || "";

      // Determine line style: solid or dashed
      const isDashed = path.classList.contains('dashed-line') ||
        path.classList.contains('dotted-line') ||
        pathClass.includes('dashed') ||
        pathClass.includes('dotted');
      const lineStyle = isDashed ? ".." : "--";

      let relationshipType = "";

      // Inheritance relation: <|-- or --|> (corrected inheritance relationship judgment)
      if (markerStartAttr.includes('extensionStart')) {
        // marker-start has extension, arrow at start point, means: toClass inherits fromClass
        if (isDashed) {
          // Dashed inheritance (implementation relationship): fromClass <|.. toClass
          relationshipType = `${fromClass} <|.. ${toClass}`;
        } else {
          // Solid inheritance: fromClass <|-- toClass
          relationshipType = `${fromClass} <|${lineStyle} ${toClass}`;
        }
      }
      else if (markerEndAttr.includes('extensionEnd')) {
        // marker-end has extension, arrow at end point, means: fromClass inherits toClass
        if (isDashed) {
          // Dashed inheritance (implementation relationship): toClass <|.. fromClass
          relationshipType = `${toClass} <|.. ${fromClass}`;
        } else {
          // Solid inheritance: toClass <|-- fromClass
          relationshipType = `${toClass} <|${lineStyle} ${fromClass}`;
        }
      }
      // Implementation relation: ..|> (corrected implementation relationship judgment)
      else if (markerStartAttr.includes('lollipopStart') || markerStartAttr.includes('implementStart')) {
        relationshipType = `${toClass} ..|> ${fromClass}`;
      }
      else if (markerEndAttr.includes('implementEnd') || markerEndAttr.includes('lollipopEnd') ||
        (markerEndAttr.includes('interfaceEnd') && isDashed)) {
        relationshipType = `${fromClass} ..|> ${toClass}`;
      }
      // Composition relation: *-- (corrected composition relationship judgment)
      else if (markerStartAttr.includes('compositionStart')) {
        // marker-start has composition, diamond at start point, means: fromClass *-- toClass
        relationshipType = `${fromClass} *${lineStyle} ${toClass}`;
      }
      else if (markerEndAttr.includes('compositionEnd') ||
        markerEndAttr.includes('diamondEnd') && markerEndAttr.includes('filled')) {
        relationshipType = `${toClass} *${lineStyle} ${fromClass}`;
      }
      // Aggregation relation: o-- (corrected aggregation relationship judgment)
      else if (markerStartAttr.includes('aggregationStart')) {
        // marker-start has aggregation, empty diamond at start point, means: toClass --o fromClass
        relationshipType = `${toClass} ${lineStyle}o ${fromClass}`;
      }
      else if (markerEndAttr.includes('aggregationEnd') ||
        markerEndAttr.includes('diamondEnd') && !markerEndAttr.includes('filled')) {
        relationshipType = `${fromClass} o${lineStyle} ${toClass}`;
      }
      // Dependency relation: ..> or --> (corrected dependency relationship judgment)
      else if (markerStartAttr.includes('dependencyStart')) {
        if (isDashed) {
          relationshipType = `${toClass} <.. ${fromClass}`;
        } else {
          relationshipType = `${toClass} <-- ${fromClass}`;
        }
      }
      else if (markerEndAttr.includes('dependencyEnd')) {
        if (isDashed) {
          relationshipType = `${fromClass} ..> ${toClass}`;
        } else {
          relationshipType = `${fromClass} --> ${toClass}`;
        }
      }
      // Association relation: --> (corrected association relationship judgment)
      else if (markerStartAttr.includes('arrowStart') || markerStartAttr.includes('openStart')) {
        relationshipType = `${toClass} <${lineStyle} ${fromClass}`;
      }
      else if (markerEndAttr.includes('arrowEnd') || markerEndAttr.includes('openEnd')) {
        relationshipType = `${fromClass} ${lineStyle}> ${toClass}`;
      }
      // Arrowless solid line link: --
      else if (lineStyle === "--" && !markerEndAttr.includes('End') && !markerStartAttr.includes('Start')) {
        relationshipType = `${fromClass} -- ${toClass}`;
      }
      // Arrowless dashed line link: ..
      else if (lineStyle === ".." && !markerEndAttr.includes('End') && !markerStartAttr.includes('Start')) {
        relationshipType = `${fromClass} .. ${toClass}`;
      }
      // Default relation
      else {
        relationshipType = `${fromClass} ${lineStyle} ${toClass}`;
      }

      // Get relationship label text
      const labelText = (labelElements[index] && labelElements[index].textContent) ?
        labelElements[index].textContent.trim() : "";

      if (relationshipType) {
        mermaidLines.push(`    ${relationshipType}${labelText ? ' : ' + labelText : ''}`);
      }
    });

    if (mermaidLines.length <= 1 && Object.keys(classData).length === 0 && notes.length === 0) return null;
    return '```mermaid\n' + mermaidLines.join('\n') + '\n```';
  }

  /**
   * Helper: Convert SVG Sequence Diagram to Mermaid code
   * @param {SVGElement} svgElement - The SVG DOM element for the sequence diagram
   * @returns {string|null}
   */
  // Constants for Sequence Diagram Parsing
  const SEQ_CONSTANTS = {
    TOLERANCE: 2,
    SELF_MESSAGE_DIST: 20,
    BLOCK_TEXT_Y_MARGIN: 5,
    BLOCK_DIVIDER_Y_MARGIN: 5,
    BLOCK_DIVIDER_LOOKAHEAD: 40,
    NOTE_Y_OFFSET: 1
  };

  /**
   * Helper: Convert SVG Sequence Diagram to Mermaid code
   * @param {SVGElement} svgElement - The SVG DOM element for the sequence diagram
   * @returns {string|null}
   */
  function convertSequenceDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;

    const uniqueParticipants = parseParticipants(svgElement);
    const notes = parseNotes(svgElement, uniqueParticipants);
    const messages = parseMessages(svgElement, uniqueParticipants);
    const blocks = parseBlocks(svgElement);

    if (uniqueParticipants.length === 0 && messages.length === 0) return null;

    if (DEBUG_MODE) console.log("Sequence diagram conversion completed. Participants:", uniqueParticipants.length, "Messages:", messages.length, "Notes:", notes.length); // DEBUG

    return generateMermaidCode(uniqueParticipants, messages, notes, blocks);
  }

  function parseParticipants(svgElement) {
    const participants = [];
    if (DEBUG_MODE) console.log("Looking for sequence participants..."); // DEBUG

    // Find all participant text elements
    svgElement.querySelectorAll('text.actor-box').forEach((textEl) => {
      const name = textEl.textContent.trim().replace(/^"|"$/g, ''); // Remove quotes
      const x = parseFloat(textEl.getAttribute('x'));
      if (DEBUG_MODE) console.log("Found participant:", name, "at x:", x); // DEBUG
      if (name && !isNaN(x)) {
        participants.push({ name, x });
      }
    });

    if (DEBUG_MODE) console.log("Total participants found:", participants.length); // DEBUG
    participants.sort((a, b) => a.x - b.x);

    // Remove duplicate participants
    const uniqueParticipants = [];
    const seenNames = new Set();
    participants.forEach(p => {
      if (!seenNames.has(p.name)) {
        uniqueParticipants.push(p);
        seenNames.add(p.name);
      }
    });
    return uniqueParticipants;
  }

  function parseNotes(svgElement, uniqueParticipants) {
    const notes = [];
    svgElement.querySelectorAll('g').forEach(g => {
      const noteRect = g.querySelector('rect.note');
      const noteTextElements = g.querySelectorAll('text.noteText');

      if (noteRect && noteTextElements.length > 0) {
        const text = Array.from(noteTextElements)
          .map(el => el.textContent.trim())
          .filter(t => t)
          .join('<br/>');
        const x = parseFloat(noteRect.getAttribute('x'));
        const width = parseFloat(noteRect.getAttribute('width'));
        const leftX = x;
        const rightX = x + width;

        // Find all participants within note coverage range
        const coveredParticipants = [];
        uniqueParticipants.forEach(p => {
          // Check if participant is within note's horizontal range
          if (p.x >= leftX && p.x <= rightX) {
            coveredParticipants.push(p);
          }
        });

        // Sort by x coordinate
        coveredParticipants.sort((a, b) => a.x - b.x);

        if (coveredParticipants.length > 0) {
          let noteTarget;
          if (coveredParticipants.length === 1) {
            // Single participant
            noteTarget = coveredParticipants[0].name;
          } else {
            // Multiple participants, use first and last
            const firstParticipant = coveredParticipants[0].name;
            const lastParticipant = coveredParticipants[coveredParticipants.length - 1].name;
            noteTarget = `${firstParticipant},${lastParticipant}`;
          }

          notes.push({
            text: text,
            target: noteTarget,
            y: parseFloat(noteRect.getAttribute('y'))
          });
        }
      }
    });
    return notes;
  }

  function parseMessages(svgElement, uniqueParticipants) {
    const messages = [];

    // Collect all message texts
    const messageTexts = [];
    svgElement.querySelectorAll('text.messageText').forEach(textEl => {
      const text = textEl.textContent.trim();
      const y = parseFloat(textEl.getAttribute('y'));
      const x = parseFloat(textEl.getAttribute('x'));
      if (text && !isNaN(y)) {
        messageTexts.push({ text, y, x });
      }
    });
    messageTexts.sort((a, b) => a.y - b.y);
    if (DEBUG_MODE) console.log("Found message texts:", messageTexts.length); // DEBUG

    // Collect all message lines
    const messageLines = [];
    svgElement.querySelectorAll('line.messageLine0, line.messageLine1').forEach(lineEl => {
      const x1 = parseFloat(lineEl.getAttribute('x1'));
      const y1 = parseFloat(lineEl.getAttribute('y1'));
      const x2 = parseFloat(lineEl.getAttribute('x2'));
      const y2 = parseFloat(lineEl.getAttribute('y2'));
      const isDashed = lineEl.classList.contains('messageLine1');

      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
        messageLines.push({ x1, y1, x2, y2, isDashed });
      }
    });

    // Collect all curved message paths (self messages)
    svgElement.querySelectorAll('path.messageLine0, path.messageLine1').forEach(pathEl => {
      const d = pathEl.getAttribute('d');
      const isDashed = pathEl.classList.contains('messageLine1');

      if (d) {
        // Parse path, check if it's a self message
        const moveMatch = d.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
        const endMatch = d.match(/([^,\s]+)[,\s]+([^,\s]+)$/);

        if (moveMatch && endMatch) {
          const x1 = parseFloat(moveMatch[1]);
          const y1 = parseFloat(moveMatch[2]);
          const x2 = parseFloat(endMatch[1]);
          const y2 = parseFloat(endMatch[2]);

          // Check if it's a self message (start and end x coordinates are close)
          if (Math.abs(x1 - x2) < SEQ_CONSTANTS.SELF_MESSAGE_DIST) {
            messageLines.push({
              x1, y1, x2, y2, isDashed,
              isSelfMessage: true
            });
          }
        }
      }
    });

    messageLines.sort((a, b) => a.y1 - b.y1);
    if (DEBUG_MODE) console.log("Found message lines:", messageLines.length); // DEBUG

    // Match message lines and message text
    for (let i = 0; i < Math.min(messageLines.length, messageTexts.length); i++) {
      const line = messageLines[i];
      const messageText = messageTexts[i];

      let fromParticipant = null;
      let toParticipant = null;

      if (line.isSelfMessage) {
        // Self message - find participant closest to x1
        let minDist = Infinity;
        for (const p of uniqueParticipants) {
          const dist = Math.abs(p.x - line.x1);
          if (dist < minDist) {
            minDist = dist;
            fromParticipant = toParticipant = p.name;
          }
        }
      } else {
        // Find sender and receiver based on x coordinates
        let minDist1 = Infinity;
        for (const p of uniqueParticipants) {
          const dist = Math.abs(p.x - line.x1);
          if (dist < minDist1) {
            minDist1 = dist;
            fromParticipant = p.name;
          }
        }

        let minDist2 = Infinity;
        for (const p of uniqueParticipants) {
          const dist = Math.abs(p.x - line.x2);
          if (dist < minDist2) {
            minDist2 = dist;
            toParticipant = p.name;
          }
        }
      }

      if (fromParticipant && toParticipant) {
        // Determine arrow type
        let arrow;
        if (line.isDashed) {
          arrow = '-->>'; // Dashed arrow
        } else {
          arrow = '->>'; // Solid arrow
        }

        messages.push({
          from: fromParticipant,
          to: toParticipant,
          text: messageText.text,
          arrow: arrow,
          y: line.y1,
          isSelfMessage: line.isSelfMessage || false
        });

        if (DEBUG_MODE) console.log(`Message ${i + 1}: ${fromParticipant} ${arrow} ${toParticipant}: ${messageText.text}`); // DEBUG
      }
    }
    return messages;
  }

  function parseBlocks(svgElement) {
    const blocks = [];
    const loopLines = Array.from(svgElement.querySelectorAll('line.loopLine'));

    // Group lines into boxes (rectangles)
    // A box is defined by 4 lines (top, bottom, left, right)
    // We need to find connected components of lines
    const processedLines = new Set();

    function findConnectedLines(startLine, currentGroup) {
      const stack = [startLine];
      while (stack.length > 0) {
        const line = stack.pop();
        if (processedLines.has(line)) continue;
        processedLines.add(line);
        currentGroup.push(line);

        const x1 = parseFloat(line.getAttribute('x1'));
        const y1 = parseFloat(line.getAttribute('y1'));
        const x2 = parseFloat(line.getAttribute('x2'));
        const y2 = parseFloat(line.getAttribute('y2'));

        loopLines.forEach(otherLine => {
          if (processedLines.has(otherLine)) return;

          const ox1 = parseFloat(otherLine.getAttribute('x1'));
          const oy1 = parseFloat(otherLine.getAttribute('y1'));
          const ox2 = parseFloat(otherLine.getAttribute('x2'));
          const oy2 = parseFloat(otherLine.getAttribute('y2'));

          // Check if endpoints touch (with small tolerance)
          const touches =
            (Math.abs(x1 - ox1) < SEQ_CONSTANTS.TOLERANCE && Math.abs(y1 - oy1) < SEQ_CONSTANTS.TOLERANCE) ||
            (Math.abs(x1 - ox2) < SEQ_CONSTANTS.TOLERANCE && Math.abs(y1 - oy2) < SEQ_CONSTANTS.TOLERANCE) ||
            (Math.abs(x2 - ox1) < SEQ_CONSTANTS.TOLERANCE && Math.abs(y2 - oy1) < SEQ_CONSTANTS.TOLERANCE) ||
            (Math.abs(x2 - ox2) < SEQ_CONSTANTS.TOLERANCE && Math.abs(y2 - oy2) < SEQ_CONSTANTS.TOLERANCE);

          if (touches) {
            stack.push(otherLine);
          }
        });
      }
    }

    loopLines.forEach(line => {
      if (!processedLines.has(line)) {
        const group = [];
        findConnectedLines(line, group);

        // A valid block box should have at least 4 lines
        if (group.length >= 4) {
          const xs = group.map(l => [parseFloat(l.getAttribute('x1')), parseFloat(l.getAttribute('x2'))]).flat();
          const ys = group.map(l => [parseFloat(l.getAttribute('y1')), parseFloat(l.getAttribute('y2'))]).flat();

          const xMin = Math.min(...xs);
          const xMax = Math.max(...xs);
          const yMin = Math.min(...ys);
          const yMax = Math.max(...ys);

          // Find label text associated with this block
          // Usually inside the block, near top-left
          let labelText = '';
          let type = 'loop'; // Default
          let condition = '';

          // Find all loopText and labelText elements inside this box
          const textElements = Array.from(svgElement.querySelectorAll('.loopText, .labelText'));
          const blockTexts = textElements.filter(el => {
            const tx = parseFloat(el.getAttribute('x'));
            const ty = parseFloat(el.getAttribute('y'));
            return tx >= xMin && tx <= xMax && ty >= yMin && ty <= yMax;
          });

          // Sort by Y then X to get order: Label, [Condition]
          blockTexts.sort((a, b) => {
            const ay = parseFloat(a.getAttribute('y'));
            const by = parseFloat(b.getAttribute('y'));
            if (Math.abs(ay - by) < SEQ_CONSTANTS.BLOCK_TEXT_Y_MARGIN) {
              return parseFloat(a.getAttribute('x')) - parseFloat(b.getAttribute('x'));
            }
            return ay - by;
          });

          if (blockTexts.length > 0) {
            const firstText = blockTexts[0].textContent.trim();
            // Check if first text is a known block type
            const knownTypes = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'];
            if (knownTypes.includes(firstText)) {
              type = firstText;
              // If there is a second text, it's likely the condition
              if (blockTexts.length > 1) {
                condition = blockTexts[1].textContent.trim().replace(/^\[|\]$/g, '');
              }
            } else {
              // If not a known type, assume it's the condition for a loop (default)
              // OR it might be "loop [condition]" split
              condition = firstText.replace(/^\[|\]$/g, '');
            }
          }

          // Check for dividers (dashed lines) inside the block (for alt/par)
          const dividers = [];
          if (type === 'alt' || type === 'par') {
            // Find lines that are dashed and inside the box
            // We iterate over ALL loopLines to find those that are geometrically inside this block
            loopLines.forEach(l => {
              // Skip if this line is part of the border group (optimization, though strictly not necessary if we check bounds)
              // Actually, border lines are solid, dividers are dashed.

              const style = l.getAttribute('style') || '';
              const isDashed = style.includes('stroke-dasharray') || l.getAttribute('stroke-dasharray');

              if (!isDashed) return;

              const ly1 = parseFloat(l.getAttribute('y1'));
              const ly2 = parseFloat(l.getAttribute('y2'));
              const lx1 = parseFloat(l.getAttribute('x1'));
              const lx2 = parseFloat(l.getAttribute('x2'));

              // Check if it's a horizontal line
              if (Math.abs(ly1 - ly2) < 1) {
                // Check if it is strictly inside the vertical bounds of the block
                if (ly1 > yMin + SEQ_CONSTANTS.BLOCK_DIVIDER_Y_MARGIN && ly1 < yMax - SEQ_CONSTANTS.BLOCK_DIVIDER_Y_MARGIN) {
                  // Check if it is within the horizontal bounds (allowing some tolerance or full width)
                  // Usually dividers span the full width or close to it
                  if (Math.min(lx1, lx2) >= xMin - SEQ_CONSTANTS.BLOCK_DIVIDER_Y_MARGIN && Math.max(lx1, lx2) <= xMax + SEQ_CONSTANTS.BLOCK_DIVIDER_Y_MARGIN) {
                    // It's a divider
                    // Find the condition text for this else block
                    // The text should be just below this line
                    let elseCondition = '';
                    const elseText = blockTexts.find(t => {
                      const ty = parseFloat(t.getAttribute('y'));
                      return ty > ly1 && ty < ly1 + SEQ_CONSTANTS.BLOCK_DIVIDER_LOOKAHEAD; // Look within 40px below divider
                    });
                    if (elseText) {
                      elseCondition = elseText.textContent.trim().replace(/^\[|\]$/g, '');
                    }
                    dividers.push({ y: ly1, condition: elseCondition });
                  }
                }
              }
            });
            dividers.sort((a, b) => a.y - b.y);
          }

          blocks.push({ xMin, xMax, yMin, yMax, type, condition, dividers });
          if (DEBUG_MODE) console.log(`Found block: ${type} [${condition}] from y ${yMin} to ${yMax}, dividers: ${dividers.length}`); // DEBUG
        }
      }
    });
    return blocks;
  }

  function generateMermaidCode(uniqueParticipants, messages, notes, blocks) {
    let mermaidOutput = "sequenceDiagram\n";

    // Add participants
    uniqueParticipants.forEach(p => {
      mermaidOutput += `  participant ${p.name}\n`;
    });
    mermaidOutput += "\n";

    // Sort all events by y coordinate (messages, notes, blocks)
    const events = [];

    messages.forEach(msg => {
      events.push({ type: 'message', y: msg.y, data: msg });
    });

    notes.forEach(note => {
      events.push({ type: 'note', y: note.y, data: note });
    });

    blocks.forEach(block => {
      events.push({ type: 'block_start', y: block.yMin - 1, data: block });
      // Add divider events
      if (block.dividers) {
        block.dividers.forEach(div => {
          events.push({ type: 'block_divider', y: div.y, data: { ...div, parentType: block.type } });
        });
      }
      events.push({ type: 'block_end', y: block.yMax + 1, data: block });
    });

    events.sort((a, b) => a.y - b.y);

    // Generate events
    let blockStack = [];
    events.forEach(event => {
      if (event.type === 'block_start') {
        const block = event.data;
        const condition = block.condition ? ` ${block.condition}` : '';
        mermaidOutput += `  ${block.type}${condition}\n`;
        blockStack.push(block);
      } else if (event.type === 'block_divider') {
        const div = event.data;
        const condition = div.condition ? ` ${div.condition}` : '';
        if (div.parentType === 'alt') {
          mermaidOutput += `  else${condition}\n`;
        } else if (div.parentType === 'par') {
          mermaidOutput += `  and${condition}\n`;
        } else {
          mermaidOutput += `  else${condition}\n`; // Default fallback
        }
      } else if (event.type === 'block_end') {
        if (blockStack.length > 0) {
          mermaidOutput += `  end\n`;
          blockStack.pop();
        }
      } else if (event.type === 'note') {
        const indent = blockStack.length > 0 ? '  ' : '';
        mermaidOutput += `${indent}  note over ${event.data.target}: ${event.data.text}\n`;
      } else if (event.type === 'message') {
        const indent = blockStack.length > 0 ? '  ' : '';
        const msg = event.data;
        mermaidOutput += `${indent}  ${msg.from}${msg.arrow}${msg.to}: ${msg.text}\n`;
      }
    });

    // Close remaining blocks
    while (blockStack.length > 0) {
      mermaidOutput += `  end\n`;
      blockStack.pop();
    }

    if (DEBUG_MODE) console.log("Generated sequence mermaid code:", mermaidOutput.substring(0, 200) + "..."); // DEBUG
    return '```mermaid\n' + mermaidOutput.trim() + '\n```';
  }

  /**
   * Helper: Convert SVG State Diagram to Mermaid code
   * @param {SVGElement} svgElement - The SVG DOM element for the state diagram
   * @returns {string|null}
   */
  function convertStateDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;

    if (DEBUG_MODE) console.log("Converting state diagram...");

    const nodes = [];

    // 1. Parse all states
    svgElement.querySelectorAll('g.node.statediagram-state').forEach(stateEl => {
      const stateName = stateEl.querySelector('foreignObject .nodeLabel p, foreignObject .nodeLabel span')?.textContent.trim();
      if (!stateName) return;

      const transform = stateEl.getAttribute('transform');
      const rect = stateEl.querySelector('rect.basic.label-container');
      if (!transform || !rect) return;

      const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      if (!transformMatch) return;

      const tx = parseFloat(transformMatch[1]);
      const ty = parseFloat(transformMatch[2]);
      const rx = parseFloat(rect.getAttribute('x'));
      const ry = parseFloat(rect.getAttribute('y'));
      const width = parseFloat(rect.getAttribute('width'));
      const height = parseFloat(rect.getAttribute('height'));

      nodes.push({
        name: stateName,
        x1: tx + rx,
        y1: ty + ry,
        x2: tx + rx + width,
        y2: ty + ry + height
      });
      if (DEBUG_MODE) console.log(`Found State: ${stateName}`, nodes[nodes.length - 1]);
    });

    // 2. Find start state
    const startStateEl = svgElement.querySelector('g.node.default circle.state-start');
    if (startStateEl) {
      const startGroup = startStateEl.closest('g.node');
      const transform = startGroup.getAttribute('transform');
      const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
      const r = parseFloat(startStateEl.getAttribute('r'));
      if (transformMatch && r) {
        const tx = parseFloat(transformMatch[1]);
        const ty = parseFloat(transformMatch[2]);
        nodes.push({
          name: '[*]',
          x1: tx - r,
          y1: ty - r,
          x2: tx + r,
          y2: ty + r,
          isSpecial: true
        });
        if (DEBUG_MODE) console.log("Found Start State", nodes[nodes.length - 1]);
      }
    }

    // 3. Find end state
    svgElement.querySelectorAll('g.node.default').forEach(endGroup => {
      if (endGroup.querySelectorAll('path').length >= 2) {
        const transform = endGroup.getAttribute('transform');
        if (transform) {
          const transformMatch = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
          if (transformMatch) {
            const tx = parseFloat(transformMatch[1]);
            const ty = parseFloat(transformMatch[2]);
            const r = 7; // Mermaid end circle radius is 7
            nodes.push({
              name: '[*]',
              x1: tx - r,
              y1: ty - r,
              x2: tx + r,
              y2: ty + r,
              isSpecial: true
            });
            if (DEBUG_MODE) console.log("Found End State", nodes[nodes.length - 1]);
          }
        }
      }
    });

    // 4. Get all labels
    const labels = [];
    svgElement.querySelectorAll('g.edgeLabel').forEach(labelEl => {
      const text = labelEl.querySelector('foreignObject .edgeLabel p, foreignObject .edgeLabel span')?.textContent.trim().replace(/^"|"$/g, '');
      const transform = labelEl.getAttribute('transform');
      if (text && transform) {
        const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
        if (match) {
          labels.push({
            text: text,
            x: parseFloat(match[1]),
            y: parseFloat(match[2])
          });
        }
      }
    });

    function getDistanceToBox(px, py, box) {
      const dx = Math.max(box.x1 - px, 0, px - box.x2);
      const dy = Math.max(box.y1 - py, 0, py - box.y2);
      return Math.sqrt(dx * dx + dy * dy);
    }

    function getDistance(x1, y1, x2, y2) {
      return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
    }

    const transitions = [];

    // 5. Process paths
    svgElement.querySelectorAll('path.transition').forEach(pathEl => {
      const dAttr = pathEl.getAttribute('d');
      if (!dAttr) return;

      const startMatch = dAttr.match(/M\s*([^,\s]+)[,\s]+([^,\s]+)/);
      // More robustly find the last coordinate pair in the d string
      const pathSegments = dAttr.split(/[A-Za-z]/);
      const lastSegment = pathSegments[pathSegments.length - 1].trim();
      const endCoords = lastSegment.split(/[\s,]+/).map(parseFloat);

      if (!startMatch || endCoords.length < 2) return;

      const startX = parseFloat(startMatch[1]);
      const startY = parseFloat(startMatch[2]);
      const endX = endCoords[endCoords.length - 2];
      const endY = endCoords[endCoords.length - 1];

      let sourceNode = null, targetNode = null;
      let minSourceDist = Infinity, minTargetDist = Infinity;

      nodes.forEach(node => {
        const distToStart = getDistanceToBox(startX, startY, node);
        if (distToStart < minSourceDist) {
          minSourceDist = distToStart;
          sourceNode = node;
        }
        const distToEnd = getDistanceToBox(endX, endY, node);
        if (distToEnd < minTargetDist) {
          minTargetDist = distToEnd;
          targetNode = node;
        }
      });

      let transitionLabel = '';
      if (sourceNode && targetNode && (minSourceDist < 5) && (minTargetDist < 5)) {
        // Find label
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        let closestLabel = null;
        let minLabelDist = Infinity;

        labels.forEach(label => {
          const dist = getDistance(midX, midY, label.x, label.y);
          if (dist < minLabelDist) {
            minLabelDist = dist;
            closestLabel = label;
          }
        });

        if (closestLabel && minLabelDist < 150) { // Arbitrary threshold, seems to work
          transitionLabel = closestLabel.text;
        }

        if (sourceNode === targetNode) return; // Ignore self-loops for now

        const newTransition = {
          from: sourceNode.name,
          to: targetNode.name,
          label: transitionLabel
        };

        // Avoid adding duplicates
        if (!transitions.some(t => t.from === newTransition.from && t.to === newTransition.to && t.label === newTransition.label)) {
          transitions.push(newTransition);
        }
      }
    });

    // 6. Generate Mermaid code
    let mermaidCode = "stateDiagram-v2\n";
    transitions.forEach(t => {
      let line = `    ${t.from} --> ${t.to}`;
      if (t.label) {
        line += ` : "${t.label}"`;
      }
      mermaidCode += line + '\n';
    });

    if (transitions.length === 0) return null;

    if (DEBUG_MODE) {
      console.log("State diagram conversion completed. Transitions:", transitions.length);
      console.log("Generated state diagram mermaid code:", mermaidCode);
    }

    return '```mermaid\n' + mermaidCode.trim() + '\n```';
  }
  // Helper function: recursively process nodes
  function processNode(node) {
    // console.log("processNode START:", node.nodeName, node.nodeType, node.textContent ? node.textContent.substring(0,50) : ''); // DEBUG
    let resultMd = "";

    if (node.nodeType === Node.TEXT_NODE) {
      if (node.parentNode && node.parentNode.nodeName === 'PRE') { return node.textContent; }
      // Fix: For normal text nodes, avoid consecutive blank lines being converted to a single newline, 
      // then having \n\n added by outer logic causing too many empty lines
      // Simply return the text and let the parent block element handle the trailing \n\n
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const element = node;
    const style = window.getComputedStyle(element);

    if (
      (style.display === "none" || style.visibility === "hidden") &&
      !["DETAILS", "SUMMARY"].includes(element.nodeName)
    ) {
      return "";
    }

    if (element.matches('button, [role="button"], nav, footer, aside, script, style, noscript, iframe, embed, object, header')) { // Added header to general skip
      return "";
    }
    if (element.classList.contains("bg-input-dark") && element.querySelector("svg")) { // Your specific rule
      return "";
    }


    // Main logic wrapped in try...catch to catch errors when processing specific nodes
    try {
      switch (element.nodeName) {
        case "P": {
          let txt = "";
          element.childNodes.forEach((c) => {
            try { txt += processNode(c); } catch (e) { console.error("Error processing child of P:", c, e); txt += "[err]"; }
          });
          txt = txt.trim();
          if (txt.startsWith("```mermaid") && txt.endsWith("```")) { // Already processed as Mermaid
            resultMd = txt + "\n\n";
          } else if (txt) {
            resultMd = txt + "\n\n";
          } else {
            resultMd = "\n"; // Keep empty P tag as a newline if needed
          }
          break;
        }
        case "H1": resultMd = (element.textContent.trim() ? `# ${element.textContent.trim()}\n\n` : ""); break;
        case "H2": resultMd = (element.textContent.trim() ? `## ${element.textContent.trim()}\n\n` : ""); break;
        case "H3": resultMd = (element.textContent.trim() ? `### ${element.textContent.trim()}\n\n` : ""); break;
        case "H4": resultMd = (element.textContent.trim() ? `#### ${element.textContent.trim()}\n\n` : ""); break;
        case "H5": resultMd = (element.textContent.trim() ? `##### ${element.textContent.trim()}\n\n` : ""); break;
        case "H6": resultMd = (element.textContent.trim() ? `###### ${element.textContent.trim()}\n\n` : ""); break;
        case "UL": {
          let list = "";
          // Determine if it is a source-related ul
          const isSourceList = (
            (element.previousElementSibling && /source/i.test(element.previousElementSibling.textContent)) ||
            (element.parentElement && /source/i.test(element.parentElement.textContent)) ||
            element.classList.contains('source-list')
          );
          element.querySelectorAll(":scope > li").forEach((li) => {
            let liTxt = "";
            li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]"; } });
            if (isSourceList) {
              liTxt = liTxt.trim().replace(/\n+/g, ' '); // Merge source-related li into one line
            } else {
              liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
            }
            if (liTxt) list += `* ${liTxt}\n`;
          });
          resultMd = list + (list ? "\n" : "");
          break;
        }
        case "OL": {
          let list = "";
          let i = 1;
          // Determine if it is a source-related ol
          const isSourceList = (
            (element.previousElementSibling && /source/i.test(element.previousElementSibling.textContent)) ||
            (element.parentElement && /source/i.test(element.parentElement.textContent)) ||
            element.classList.contains('source-list')
          );
          element.querySelectorAll(":scope > li").forEach((li) => {
            let liTxt = "";
            li.childNodes.forEach((c) => { try { liTxt += processNode(c); } catch (e) { console.error("Error processing child of LI:", c, e); liTxt += "[err]"; } });
            if (isSourceList) {
              liTxt = liTxt.trim().replace(/\n+/g, ' ');
            } else {
              liTxt = liTxt.trim().replace(/\n\n$/, "").replace(/^\n\n/, "");
            }
            if (liTxt) {
              list += `${i}. ${liTxt}\n`;
              i++;
            }
          });
          resultMd = list + (list ? "\n" : "");
          break;
        }
        case "PRE": {
          const svgElement = element.querySelector('svg[id^="mermaid-"]');
          let mermaidOutput = null;

          if (svgElement) {
            const diagramTypeDesc = svgElement.getAttribute('aria-roledescription');
            const diagramClass = svgElement.getAttribute('class');

            if (DEBUG_MODE) console.log("Found SVG in PRE: desc=", diagramTypeDesc, "class=", diagramClass); // DEBUG
            if (DEBUG_MODE) {
              if (diagramTypeDesc && diagramTypeDesc.includes('flowchart')) {
                console.log("Trying to convert flowchart..."); // DEBUG
                mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('class')) {
                console.log("Trying to convert class diagram..."); // DEBUG
                mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('sequence')) {
                console.log("Trying to convert sequence diagram..."); // DEBUG
                mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('stateDiagram')) {
                console.log("Trying to convert state diagram..."); // DEBUG
                mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && diagramClass.includes('flowchart')) {
                console.log("Trying to convert flowchart by class..."); // DEBUG
                mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('classDiagram') || diagramClass.includes('class'))) {
                console.log("Trying to convert class diagram by class..."); // DEBUG
                mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('sequenceDiagram') || diagramClass.includes('sequence'))) {
                console.log("Trying to convert sequence diagram by class..."); // DEBUG
                mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('statediagram') || diagramClass.includes('stateDiagram'))) {
                console.log("Trying to convert state diagram by class..."); // DEBUG
                mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
              }
            } else {
              // Non-debug mode: just call the functions without logging
              if (diagramTypeDesc && diagramTypeDesc.includes('flowchart')) {
                mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('class')) {
                mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('sequence')) {
                mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
              } else if (diagramTypeDesc && diagramTypeDesc.includes('stateDiagram')) {
                mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && diagramClass.includes('flowchart')) {
                mermaidOutput = convertFlowchartSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('classDiagram') || diagramClass.includes('class'))) {
                mermaidOutput = convertClassDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('sequenceDiagram') || diagramClass.includes('sequence'))) {
                mermaidOutput = convertSequenceDiagramSvgToMermaidText(svgElement);
              } else if (diagramClass && (diagramClass.includes('statediagram') || diagramClass.includes('stateDiagram'))) {
                mermaidOutput = convertStateDiagramSvgToMermaidText(svgElement);
              }
            }

            if (mermaidOutput) {
              if (DEBUG_MODE) console.log("Successfully converted SVG to mermaid:", mermaidOutput.substring(0, 100) + "..."); // DEBUG
            } else {
              if (DEBUG_MODE) console.log("Failed to convert SVG, using fallback"); // DEBUG
            }
          }

          if (mermaidOutput) {
            resultMd = `\n${mermaidOutput}\n\n`;
          } else {
            const code = element.querySelector("code");
            let lang = "";
            let txt = "";
            if (code) {
              txt = code.textContent;
              const cls = Array.from(code.classList).find((c) => c.startsWith("language-"));
              if (cls) lang = cls.replace("language-", "");
            } else {
              txt = element.textContent;
            }
            if (!lang) {
              const preCls = Array.from(element.classList).find((c) => c.startsWith("language-"));
              if (preCls) lang = preCls.replace("language-", "");
            }
            // Auto-detect language if still not found
            if (!lang && txt.trim()) {
              lang = detectCodeLanguage(txt);
            }
            resultMd = `\`\`\`${lang}\n${txt.trim()}\n\`\`\`\n\n`;
          }
          break;
        }
        case "A": {
          const href = element.getAttribute("href");
          let initialTextFromNodes = ""; // Collect raw text from children first
          element.childNodes.forEach(c => {
            try {
              initialTextFromNodes += processNode(c);
            } catch (e) {
              console.error("Error processing child of A:", c, e);
              initialTextFromNodes += "[err]";
            }
          });
          let text = initialTextFromNodes.trim(); // This is the base text for further processing

          if (!text && element.querySelector('img')) { // Handle img alt text if link content is empty
            text = element.querySelector('img').alt || 'image';
          }
          // `text` is now the initial display text, possibly from content or image alt.
          // `initialTextFromNodes` keeps the original structure for context like "Sources: [...]".

          if (href && (href.startsWith('http') || href.startsWith('https') || href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:'))) {

            let finalLinkDisplayText = text; // Start with the current text, may be overwritten by line logic

            const lineInfoMatch = href.match(/#L(\d+)(?:-L(\d+))?$/);

            if (lineInfoMatch) {
              const pathPart = href.substring(0, href.indexOf('#'));
              let filenameFromPath = pathPart.substring(pathPart.lastIndexOf('/') + 1) || "link"; // Default filename

              const startLine = lineInfoMatch[1];
              const endLine = lineInfoMatch[2]; // This is the number after -L, or undefined

              let displayFilename = filenameFromPath; // Start with filename from path

              const trimmedInitialText = initialTextFromNodes.trim(); // Trim for reliable prefix/suffix checks
              let textToParseForFilename = trimmedInitialText;

              const isSourcesContext = trimmedInitialText.startsWith("Sources: [") && trimmedInitialText.endsWith("]");

              if (isSourcesContext) {
                const sourcesContentMatch = trimmedInitialText.match(/^Sources:\s+\[(.*)\]$/);
                if (sourcesContentMatch && sourcesContentMatch[1]) {
                  textToParseForFilename = sourcesContentMatch[1].trim(); // Content inside "Sources: [...]"
                }
              }

              // Extract filename hint from (potentially sources-stripped) textToParseForFilename
              // This regex targets the first part that looks like a filename.
              const filenameHintMatch = textToParseForFilename.match(/^[\w\/\.-]+(?:\.\w+)?/);
              if (filenameHintMatch && filenameHintMatch[0]) { // Use filenameHintMatch[0] for the matched string
                // Verify this extracted filename by checking if it's part of the href's path
                if (pathPart.includes(filenameHintMatch[0])) {
                  displayFilename = filenameHintMatch[0];
                }
              }

              let lineRefText;
              if (endLine && endLine !== startLine) { // Range like L10-L20
                lineRefText = `L${startLine}-L${endLine}`;
              } else { // Single line like L10, or L10-L10 treated as L10
                lineRefText = `L${startLine}`;
              }

              let constructedText = `${displayFilename} ${lineRefText}`;

              if (isSourcesContext) {
                finalLinkDisplayText = `Sources: [${constructedText}]`;
              } else {
                // If not a "Sources:" link, use the newly constructed clean text
                finalLinkDisplayText = constructedText;
              }
            }

            // Fallback: if finalLinkDisplayText is empty (e.g. original text was empty and no lineInfoMatch)
            // or if it became empty after processing, use href.
            text = finalLinkDisplayText.trim() || (href ? href : ""); // Ensure text is not empty if href exists

            resultMd = `[${text}](${href})`;
            if (window.getComputedStyle(element).display !== "inline") {
              resultMd += "\n\n";
            }
          } else {
            // Non-http/s/... link, or no href. Fallback text if empty.
            text = text.trim() || (href ? href : "");
            resultMd = text;
            if (window.getComputedStyle(element).display !== "inline" && text.trim()) {
              resultMd += "\n\n";
            }
          }
          break;
        }
        case "IMG":
          if (element.closest && element.closest('a')) return "";
          resultMd = (element.src ? `![${element.alt || ""}](${element.src})\n\n` : "");
          break;
        case "BLOCKQUOTE": {
          let qt = "";
          element.childNodes.forEach((c) => { try { qt += processNode(c); } catch (e) { console.error("Error processing child of BLOCKQUOTE:", c, e); qt += "[err]"; } });
          const trimmedQt = qt.trim();
          if (trimmedQt) {
            resultMd = trimmedQt.split("\n").map((l) => `> ${l.trim() ? l : ''}`).filter(l => l.trim() !== '>').join("\n") + "\n\n";
          } else {
            resultMd = "";
          }
          break;
        }
        case "HR":
          resultMd = "\n---\n\n";
          break;
        case "STRONG":
        case "B": {
          let st = "";
          element.childNodes.forEach((c) => { try { st += processNode(c); } catch (e) { console.error("Error processing child of STRONG/B:", c, e); st += "[err]"; } });
          return `**${st.trim()}**`; // Return directly
        }
        case "EM":
        case "I": {
          let em = "";
          element.childNodes.forEach((c) => { try { em += processNode(c); } catch (e) { console.error("Error processing child of EM/I:", c, e); em += "[err]"; } });
          return `*${em.trim()}*`; // Return directly
        }
        case "CODE": {
          if (element.parentNode && element.parentNode.nodeName === 'PRE') {
            return element.textContent;
          }
          return `\`${element.textContent.trim()}\``; // Return directly
        }
        case "BR":
          if (element.parentNode && ['P', 'DIV', 'LI'].includes(element.parentNode.nodeName)) { // Added LI
            const nextSibling = element.nextSibling;
            // Add markdown hard break only if BR is followed by text or is at the end of a line within a block
            if (!nextSibling || (nextSibling.nodeType === Node.TEXT_NODE && nextSibling.textContent.trim() !== '') || nextSibling.nodeType === Node.ELEMENT_NODE) {
              return "  \n"; // Return directly
            }
          }
          return ""; // Return directly (or empty if not a hard break)
        case "TABLE": {
          let tableMd = "";
          const headerRows = Array.from(element.querySelectorAll(':scope > thead > tr, :scope > tr:first-child'));
          const bodyRows = Array.from(element.querySelectorAll(':scope > tbody > tr'));
          const allRows = Array.from(element.rows); // Fallback

          let rowsToProcessForHeader = headerRows;
          if (headerRows.length === 0 && allRows.length > 0) { // Infer header if THEAD is missing
            rowsToProcessForHeader = [allRows[0]];
          }

          if (rowsToProcessForHeader.length > 0) {
            const headerRowElement = rowsToProcessForHeader[0];
            let headerContent = "|"; let separator = "|";
            Array.from(headerRowElement.cells).forEach(cell => {
              let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Header):", c, e); cellText += "[err]"; } });
              headerContent += ` ${cellText.trim().replace(/\|/g, "\\|")} |`; separator += ` --- |`;
            });
            tableMd += `${headerContent}\n${separator}\n`;
          }

          let rowsToProcessForBody = bodyRows;
          if (bodyRows.length === 0 && allRows.length > (headerRows.length > 0 ? 1 : 0)) { // If no TBODY, take remaining rows
            rowsToProcessForBody = headerRows.length > 0 ? allRows.slice(1) : allRows;
          }


          rowsToProcessForBody.forEach(row => {
            // Ensure we don't re-process a header row if using allRows fallback logic above and header was found
            if (rowsToProcessForHeader.length > 0 && rowsToProcessForHeader.includes(row)) return;

            let rowContent = "|";
            Array.from(row.cells).forEach(cell => {
              let cellText = ""; cell.childNodes.forEach(c => { try { cellText += processNode(c); } catch (e) { console.error("Error processing child of TH/TD (Body):", c, e); cellText += "[err]"; } });
              rowContent += ` ${cellText.trim().replace(/\|/g, "\\|").replace(/\n+/g, ' <br> ')} |`;
            });
            tableMd += `${rowContent}\n`;
          });
          resultMd = tableMd + (tableMd ? "\n" : "");
          break;
        }
        case "THEAD": case "TBODY": case "TFOOT": case "TR": case "TH": case "TD":
          return ""; // Handled by TABLE case, return empty string if processed directly

        case "DETAILS": {
          let summaryText = "Details"; const summaryElem = element.querySelector('summary');
          if (summaryElem) { let tempSummary = ""; summaryElem.childNodes.forEach(c => { try { tempSummary += processNode(c); } catch (e) { console.error("Error processing child of SUMMARY:", c, e); tempSummary += "[err]"; } }); summaryText = tempSummary.trim() || "Details"; }
          let detailsContent = "";
          Array.from(element.childNodes).forEach(child => { if (child.nodeName !== "SUMMARY") { try { detailsContent += processNode(child); } catch (e) { console.error("Error processing child of DETAILS:", c, e); detailsContent += "[err]"; } } });
          resultMd = `> **${summaryText}**\n${detailsContent.trim().split('\n').map(l => `> ${l}`).join('\n')}\n\n`;
          break;
        }
        case "SUMMARY": return ""; // Handled by DETAILS

        case "DIV":
        case "SPAN":
        case "SECTION":
        case "ARTICLE":
        case "MAIN":
        default: {
          let txt = "";
          element.childNodes.forEach((c) => { try { txt += processNode(c); } catch (e) { console.error("Error processing child of DEFAULT case:", c, element.nodeName, e); txt += "[err]"; } });

          const d = window.getComputedStyle(element);
          const isBlock = ["block", "flex", "grid", "list-item", "table",
            "table-row-group", "table-header-group", "table-footer-group"].includes(d.display);

          if (isBlock && txt.trim()) {
            // Ensure that text from children which already ends in \n\n isn't given more \n\n
            if (txt.endsWith('\n\n')) {
              resultMd = txt;
            } else if (txt.endsWith('\n')) { // if it ends with one \n, add one more for spacing
              resultMd = txt + '\n';
            } else { // if it has no trailing newlines, add two.
              resultMd = txt.trimEnd() + "\n\n";
            }
          } else { // Inline element or empty block element
            return txt; // Return directly
          }
        }
      }
    } catch (error) {
      console.error("Unhandled error in processNode for element:", element.nodeName, element, error);
      return `\n[ERROR_PROCESSING_ELEMENT: ${element.nodeName}]\n\n`; // Return an error placeholder
    }
    // console.log("processNode END for:", element.nodeName, "Output:", resultMd.substring(0,50)); // DEBUG
    return resultMd;
  }

  // Function to auto-detect programming language from code content
  function detectCodeLanguage(codeText) {
    if (!codeText || codeText.trim().length < 10) return '';

    const code = codeText.trim();
    const firstLine = code.split('\n')[0].trim();
    const lines = code.split('\n');

    // JavaScript/TypeScript patterns
    if (code.includes('function ') || code.includes('const ') || code.includes('let ') ||
      code.includes('var ') || code.includes('=>') || code.includes('console.log') ||
      code.includes('require(') || code.includes('import ') || code.includes('export ')) {
      if (code.includes(': ') && (code.includes('interface ') || code.includes('type ') ||
        code.includes('enum ') || code.includes('implements '))) {
        return 'typescript';
      }
      return 'javascript';
    }

    // Python patterns
    if (code.includes('def ') || code.includes('import ') || code.includes('from ') ||
      code.includes('print(') || code.includes('if __name__') || code.includes('class ') ||
      firstLine.startsWith('#!') && firstLine.includes('python')) {
      return 'python';
    }

    // Java patterns
    if (code.includes('public class ') || code.includes('private ') || code.includes('public static void main') ||
      code.includes('System.out.println') || code.includes('import java.')) {
      return 'java';
    }

    // C# patterns
    if (code.includes('using System') || code.includes('namespace ') || code.includes('public class ') ||
      code.includes('Console.WriteLine') || code.includes('[Attribute]')) {
      return 'csharp';
    }

    // C/C++ patterns
    if (code.includes('#include') || code.includes('int main') || code.includes('printf(') ||
      code.includes('cout <<') || code.includes('std::')) {
      return code.includes('std::') || code.includes('cout') ? 'cpp' : 'c';
    }

    // Go patterns
    if (code.includes('package ') || code.includes('func ') || code.includes('import (') ||
      code.includes('fmt.Printf') || code.includes('go ')) {
      return 'go';
    }

    // Rust patterns
    if (code.includes('fn ') || code.includes('let mut') || code.includes('println!') ||
      code.includes('use std::') || code.includes('impl ')) {
      return 'rust';
    }

    // PHP patterns
    if (code.includes('<?php') || code.includes('$') && (code.includes('echo ') || code.includes('print '))) {
      return 'php';
    }

    // Ruby patterns
    if (code.includes('def ') && (code.includes('end') || code.includes('puts ') || code.includes('require '))) {
      return 'ruby';
    }

    // Shell/Bash patterns
    if (firstLine.startsWith('#!') && (firstLine.includes('bash') || firstLine.includes('sh')) ||
      code.includes('#!/bin/') || code.includes('echo ') && code.includes('$')) {
      return 'bash';
    }

    // SQL patterns
    if (code.match(/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i)) {
      return 'sql';
    }

    // CSS patterns
    if (code.includes('{') && code.includes('}') && code.includes(':') &&
      (code.includes('color:') || code.includes('margin:') || code.includes('padding:') || code.includes('#'))) {
      return 'css';
    }

    // HTML patterns
    if (code.includes('<') && code.includes('>') &&
      (code.includes('<!DOCTYPE') || code.includes('<html') || code.includes('<div') || code.includes('<p'))) {
      return 'html';
    }

    // XML patterns
    if (code.includes('<?xml') || (code.includes('<') && code.includes('>') && code.includes('</'))) {
      return 'xml';
    }

    // JSON patterns
    if (code.startsWith('{') && code.endsWith('}') || code.startsWith('[') && code.endsWith(']')) {
      try {
        JSON.parse(code);
        return 'json';
      } catch (e) {
        // Not valid JSON
      }
    }

    // YAML patterns
    if (lines.some(line => line.match(/^\s*\w+:\s*/) && !line.includes('{') && !line.includes(';'))) {
      return 'yaml';
    }

    // Markdown patterns
    if (code.includes('# ') || code.includes('## ') || code.includes('```') || code.includes('[') && code.includes('](')) {
      return 'markdown';
    }

    // Docker patterns
    if (firstLine.startsWith('FROM ') || code.includes('RUN ') || code.includes('COPY ') || code.includes('WORKDIR ')) {
      return 'dockerfile';
    }

    // Default fallback
    return '';
  }

  // Notify the background script that the content script is ready
  chrome.runtime.sendMessage({ action: "contentScriptReady" });



} // End of ALLOW_SCRIPT_EXECUTION check