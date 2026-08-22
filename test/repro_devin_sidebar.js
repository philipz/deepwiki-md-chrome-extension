// Regression: Devin wiki sidebar is <a href> inside li[data-slot="sidebar-menu-item"],
// not <button aria-label>. The old button-based extraction picked up unrelated chrome
// ("Search", "Collapse sidebar", "Help"), so batch mode clicked "Search" and opened
// Devin's command palette instead of navigating.
//
// Run: node test/repro_devin_sidebar.js
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixture_devin_sidebar.html'), 'utf8');

const fnNames = ['getDevinSidebarLinks'];
const exported = {};
for (const name of fnNames) {
  const re = new RegExp(`function ${name}\\s*\\([\\s\\S]*?\\n  \\}`, 'm');
  const m = contentSrc.match(re);
  if (!m) { console.error('Could not extract', name); process.exit(1); }
  exported[name] = m[0];
}

const PAGE_URL = 'https://app.devin.ai/org/philip-zheng/wiki/philipz/software_factory?branch=main';
const dom = new JSDOM(fixture, { url: PAGE_URL });
const { window } = dom;
global.window = window;
global.document = window.document;

const sandboxSrc = Object.values(exported).join('\n') + '\nreturn getDevinSidebarLinks();';
const links = new Function('window', 'document', `${sandboxSrc}`)(window, window.document);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); }
  else { console.log(`  FAIL ${name}${detail ? ' -> ' + detail : ''}`); failures++; }
}

console.log('Devin sidebar extraction');

const titles = links.map(l => l.text);
const urls = links.map(l => new window.URL(l.getAttribute('href'), PAGE_URL).href);

check('extracts 36 wiki pages (35 numbered + Repo Note)', links.length === 36, `got ${links.length}`);

const chrome = ['Search', 'Collapse sidebar', 'Help', 'Download apps', 'Hide tab',
  'New session', 'Automations', 'Security', 'Review', 'Wiki', 'Settings'];
const leaked = titles.filter(t => chrome.includes(t));
check('excludes app chrome and org-level nav', leaked.length === 0, `leaked ${JSON.stringify(leaked)}`);

const base = 'https://app.devin.ai/org/philip-zheng/wiki/philipz/software_factory';
const outside = urls.filter(u => !u.startsWith(base + '/page/'));
check('every url is a page of the current project', outside.length === 0, JSON.stringify(outside.slice(0, 3)));

check('keeps the Overview page as page/1',
  urls.some(u => u.startsWith(base + '/page/1?')) && titles.includes('Software Factory — Overview'));

const i22 = urls.findIndex(u => u.startsWith(base + '/page/2.2?'));
check('nested page 2.2 maps to its aria-label title',
  i22 !== -1 && titles[i22] === 'Risk Scoring Engine', `idx ${i22} title ${titles[i22]}`);

check('includes the un-numbered Repo Note page',
  urls.some(u => u.startsWith(base + '/page/repo-note?')));

// Chapter numbers must be derivable from the URL alone (background.js deriveChapterNumber).
function deriveChapterNumber(url) {
  const last = new window.URL(url, PAGE_URL).pathname.split('/').filter(Boolean).pop();
  const m = /^(\d+(?:\.\d+)*)\b/.exec(last || '');
  return m ? m[1] : '';
}
const chapters = urls.map(deriveChapterNumber).filter(Boolean);
check('35 pages yield chapter numbers from their url', chapters.length === 35, `got ${chapters.length}`);
check('chapter numbers include nested levels',
  chapters.includes('1') && chapters.includes('1.1') && chapters.includes('2.2') && chapters.includes('10'));

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
