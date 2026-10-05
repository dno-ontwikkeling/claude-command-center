import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDocs, filterDocs, docsSignature, buildFrame } from '../renderer/docs-view.mjs';

const doc = (rel, mtimeMs, size = 100) => ({
  rel,
  kind: rel.startsWith('reviews/') ? 'reviews' : 'plans',
  mtimeMs,
  size,
});

const LIST = [
  doc('plans/alpha.md', 100),
  doc('reviews/Beta-Review.md', 300),
  doc('plans/gamma.md', 200),
  doc('reviews/delta.md', 50),
];

test('groupDocs gives Plans before Reviews, each newest first', () => {
  const groups = groupDocs(LIST);
  assert.deepEqual(groups.map((g) => g.label), ['Plans', 'Reviews']);
  assert.deepEqual(groups.map((g) => g.kind), ['plans', 'reviews']);
  assert.deepEqual(groups[0].docs.map((d) => d.rel), ['plans/gamma.md', 'plans/alpha.md']);
  assert.deepEqual(groups[1].docs.map((d) => d.rel), ['reviews/Beta-Review.md', 'reviews/delta.md']);
});

test('groupDocs omits empty groups', () => {
  const groups = groupDocs([doc('reviews/only.md', 1)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'Reviews');
  assert.deepEqual(groupDocs([]), []);
});

test('groupDocs does not mutate its input', () => {
  const input = [doc('plans/a.md', 1), doc('plans/b.md', 2)];
  groupDocs(input);
  assert.deepEqual(input.map((d) => d.rel), ['plans/a.md', 'plans/b.md']);
});

test('filterDocs matches the file name case-insensitively', () => {
  assert.deepEqual(filterDocs(LIST, 'BETA').map((d) => d.rel), ['reviews/Beta-Review.md']);
  assert.deepEqual(filterDocs(LIST, 'ALPHA').map((d) => d.rel), ['plans/alpha.md']);
});

test('filterDocs matches only the file name, not the folder', () => {
  assert.deepEqual(filterDocs(LIST, 'plans'), []);
  assert.deepEqual(filterDocs(LIST, 'reviews'), []);
});

test('filterDocs returns the whole list for an empty or blank query', () => {
  assert.deepEqual(filterDocs(LIST, ''), LIST);
  assert.deepEqual(filterDocs(LIST, '   '), LIST);
});

test('docsSignature is equal for equal lists', () => {
  assert.equal(docsSignature(LIST), docsSignature(LIST.map((d) => ({ ...d }))));
  assert.equal(typeof docsSignature(LIST), 'string');
});

test('docsSignature changes when path, mtime or size changes', () => {
  const base = docsSignature(LIST);
  const change = (i, patch) => LIST.map((d, j) => (j === i ? { ...d, ...patch } : d));
  assert.notEqual(docsSignature(change(0, { rel: 'plans/alpha2.md' })), base);
  assert.notEqual(docsSignature(change(0, { mtimeMs: 101 })), base);
  assert.notEqual(docsSignature(change(0, { size: 101 })), base);
});

test('docsSignature changes when a file is added or removed', () => {
  const base = docsSignature(LIST);
  assert.notEqual(docsSignature([...LIST, doc('plans/new.md', 400)]), base);
  assert.notEqual(docsSignature(LIST.slice(1)), base);
});

const TOKENS = { '--bg': '#ffffff', '--fg': '#111111' };

test('buildFrame returns a full document starting with a doctype', () => {
  const out = buildFrame('<h1>Hi</h1>', TOKENS);
  assert.ok(out.startsWith('<!doctype html>'));
  assert.ok(out.includes('<body>'));
});

test('buildFrame includes the locked-down CSP meta tag', () => {
  const out = buildFrame('<p>x</p>', TOKENS);
  assert.ok(
    out.includes(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    ),
  );
});

test('buildFrame emits theme tokens as CSS variables in :root and uses them', () => {
  const out = buildFrame('<p>x</p>', TOKENS);
  assert.match(out, /:root\s*\{[^}]*--bg:\s*#ffffff;/);
  assert.match(out, /:root\s*\{[^}]*--fg:\s*#111111;/);
  assert.match(out, /var\(--bg\)/);
  assert.match(out, /var\(--fg\)/);
});

test('buildFrame leaves the body html untouched and unescaped', () => {
  const html = '<h1 id="a">Tom &amp; <em>Jerry</em></h1>\n<pre>if (a < b) {}</pre>';
  const out = buildFrame(html, TOKENS);
  assert.ok(out.includes(`<body>${html}</body>`) || out.includes(html));
  const bodyStart = out.indexOf('<body>');
  assert.ok(out.indexOf(html) > bodyStart);
});

test('buildFrame sanitizes token values that try to break out of the style block', () => {
  const evil = { '--bg': '#fff</style><script>alert(1)</script>', '--fg': 'red; } body { display:none' };
  const out = buildFrame('<p>x</p>', evil);
  assert.ok(!out.includes('</style><script>'));
  assert.ok(!out.includes('<script>alert(1)'));
  // the only closing style tag is the one the frame itself emits
  assert.equal(out.split('</style>').length - 1, 1);
  const root = out.match(/:root\s*\{([^}]*)\}/);
  assert.ok(root, ':root rule must be a single well-formed block');
  assert.ok(!root[1].includes('body'));
});

test('buildFrame sanitizes the injected value when a token contains </style>', () => {
  const out = buildFrame('<p>x</p>', { '--bg': '</style>' });
  assert.equal(out.split('</style>').length - 1, 1);
});

test('buildFrame opens every link in a new window, so clicks never navigate the frame', () => {
  const out = buildFrame('<a href="https://example.com">x</a>', TOKENS);
  const head = out.slice(0, out.indexOf('</head>'));
  assert.ok(head.includes('<base target="_blank">'), 'base target must sit in <head>, before any doc html');
});
