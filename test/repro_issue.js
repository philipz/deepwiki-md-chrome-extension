const jsdom = require("jsdom");
const { JSDOM } = jsdom;

// Mock DOM environment
const dom = new JSDOM(`<!DOCTYPE html>
<svg id="mock-sequence">
  <!-- Participants -->
  <text class="actor-box" x="75">User</text>
  <text class="actor-box" x="283">System</text>

  <!-- Real SVG Structure for Alt Block -->
  <g>
      <line x1="64" y1="225" x2="375" y2="225" class="loopLine"></line>
      <line x1="375" y1="225" x2="375" y2="575" class="loopLine"></line>
      <line x1="64" y1="575" x2="375" y2="575" class="loopLine"></line>
      <line x1="64" y1="225" x2="64" y2="575" class="loopLine"></line>
      
      <!-- Divider -->
      <line x1="64" y1="485" x2="375" y2="485" class="loopLine" style="stroke-dasharray: 3, 3;"></line>
      
      <!-- Label Box (alt) - Note class is labelText, NOT loopText -->
      <polygon points="64,225 114,225 114,238 105.6,245 64,245" class="labelBox"></polygon>
      <text x="89" y="238" class="labelText">alt</text>
      
      <!-- Conditions -->
      <text x="244.5" y="243" class="loopText">[Event Handled]</text>
      <text x="219.5" y="503" class="loopText">[Event Ignored]</text>
  </g>

  <!-- Messages -->
  <text class="messageText" x="200" y="300">Process Interaction</text>
  <line class="messageLine0" x1="100" y1="300" x2="300" y2="300" />
  
  <text class="messageText" x="200" y="520">Default Behavior</text>
  <line class="messageLine0" x1="100" y1="530" x2="300" y2="530" />

</svg>`);

global.window = dom.window;
global.document = dom.window.document;
global.Node = dom.window.Node;

// --- PASTE convertSequenceDiagramSvgToMermaidText HERE FOR TESTING ---
// I will paste the function from content.js here dynamically or just include it.
// For now, I'll define a placeholder that mimics the current broken logic to demonstrate the failure.


function convertSequenceDiagramSvgToMermaidText(svgElement) {
    if (!svgElement) return null;

    // 1. Parse participants 
    const participants = [];
    svgElement.querySelectorAll('text.actor-box').forEach((textEl) => {
        const name = textEl.textContent.trim();
        const x = parseFloat(textEl.getAttribute('x'));
        participants.push({ name, x });
    });

    // Mock uniqueParticipants for the test
    const uniqueParticipants = participants;

    // Mock messages for the test
    const messages = [];
    const messageTexts = Array.from(svgElement.querySelectorAll('.messageText'));
    const messageLines = Array.from(svgElement.querySelectorAll('.messageLine0'));

    for (let i = 0; i < messageLines.length; i++) {
        const line = messageLines[i];
        const text = messageTexts[i] ? messageTexts[i].textContent : '';
        const y = parseFloat(line.getAttribute('y1'));
        // Simplified message parsing for test
        messages.push({
            from: 'User',
            to: 'System',
            text: text,
            arrow: '->>',
            y: y
        });
    }

    const notes = [];

    // 5. Parse block areas (loop, alt, opt, par, etc.)
    const blocks = [];
    const loopLines = Array.from(svgElement.querySelectorAll('line.loopLine'));

    // Group lines into boxes (rectangles)
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
                const tolerance = 2;
                const touches =
                    (Math.abs(x1 - ox1) < tolerance && Math.abs(y1 - oy1) < tolerance) ||
                    (Math.abs(x1 - ox2) < tolerance && Math.abs(y1 - oy2) < tolerance) ||
                    (Math.abs(x2 - ox1) < tolerance && Math.abs(y2 - oy1) < tolerance) ||
                    (Math.abs(x2 - ox2) < tolerance && Math.abs(y2 - oy2) < tolerance);

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

                // Sort by Y then X
                blockTexts.sort((a, b) => {
                    const ay = parseFloat(a.getAttribute('y'));
                    const by = parseFloat(b.getAttribute('y'));
                    if (Math.abs(ay - by) < 5) {
                        return parseFloat(a.getAttribute('x')) - parseFloat(b.getAttribute('x'));
                    }
                    return ay - by;
                });

                if (blockTexts.length > 0) {
                    const firstText = blockTexts[0].textContent.trim();
                    const knownTypes = ['loop', 'alt', 'opt', 'par', 'critical', 'break', 'rect'];
                    if (knownTypes.includes(firstText)) {
                        type = firstText;
                        if (blockTexts.length > 1) {
                            condition = blockTexts[1].textContent.trim().replace(/^\[|\]$/g, '');
                        }
                    } else {
                        condition = firstText.replace(/^\[|\]$/g, '');
                    }
                }

                // Check for dividers
                const dividers = [];
                if (type === 'alt' || type === 'par') {
                    // Find lines that are dashed and inside the box
                    loopLines.forEach(l => {
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
                            if (ly1 > yMin + 5 && ly1 < yMax - 5) {
                                // Check if it is within the horizontal bounds
                                if (Math.min(lx1, lx2) >= xMin - 5 && Math.max(lx1, lx2) <= xMax + 5) {
                                    let elseCondition = '';
                                    const elseText = blockTexts.find(t => {
                                        const ty = parseFloat(t.getAttribute('y'));
                                        return ty > ly1 && ty < ly1 + 40;
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
            }
        }
    });

    // 6. Generate Mermaid code
    let mermaidOutput = "sequenceDiagram\n";

    uniqueParticipants.forEach(p => {
        mermaidOutput += `  participant ${p.name}\n`;
    });
    mermaidOutput += "\n";

    const events = [];

    messages.forEach(msg => {
        events.push({ type: 'message', y: msg.y, data: msg });
    });

    notes.forEach(note => {
        events.push({ type: 'note', y: note.y, data: note });
    });

    blocks.forEach(block => {
        events.push({ type: 'block_start', y: block.yMin - 1, data: block });
        if (block.dividers) {
            block.dividers.forEach(div => {
                events.push({ type: 'block_divider', y: div.y, data: { ...div, parentType: block.type } });
            });
        }
        events.push({ type: 'block_end', y: block.yMax + 1, data: block });
    });

    events.sort((a, b) => a.y - b.y);

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
                mermaidOutput += `  else${condition}\n`;
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

    while (blockStack.length > 0) {
        mermaidOutput += `  end\n`;
        blockStack.pop();
    }

    return mermaidOutput;
}


const svg = document.getElementById('mock-sequence');
const result = convertSequenceDiagramSvgToMermaidText(svg);
console.log(result);

if (result.includes("loop alt")) {
    console.log("FAIL: 'alt' block detected as 'loop'");
} else if (result.includes("alt")) {
    console.log("SUCCESS: 'alt' block detected correctly");
} else {
    console.log("UNKNOWN OUTPUT");
}
