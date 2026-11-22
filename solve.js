// A fast drop-in for makefun-site 1.0.0. run(input) returns the same output
// tree makefun-site's build returns for every site, byte for byte: front
// matter, the template dialect, the Markdown subset, the slug rule and the
// build report. One file, no dependencies, Node 22.
//
// Where the speed comes from: inline Markdown is scanned by one native
// regex pass instead of one escape per character; blocks are rendered
// straight into an array instead of being lexed into tokens first; the
// front matter is found with indexOf and the body is sliced, never split
// and re-joined; slugs are cached; a link target is resolved once per
// (directory, target); template output is joined once at the end.

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- text

const FLIP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_SCAN = /[&<>"']/g;

// Escape once, with a native scan: slices between specials need no work.
function esc(s) {
  if (!ESC_SCAN.test(s)) return s;
  ESC_SCAN.lastIndex = 0;
  let out = '';
  let from = 0;
  let m;
  while ((m = ESC_SCAN.exec(s)) !== null) {
    out += s.slice(from, m.index) + FLIP[m[0]];
    from = m.index + 1;
  }
  return out + s.slice(from);
}

const MARK = /\p{M}/gu;
const slugMemo = new Map();

function toSlug(text) {
  const hit = slugMemo.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(MARK, '');
  let s = plain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  s = s.slice(0, 64);
  if (s.endsWith('-')) s = s.slice(0, -1);
  const out = s === '' ? 'untitled' : s;
  if (slugMemo.size < 200000) slugMemo.set(text, out);
  return out;
}

function uniqSlug(base, taken) {
  let n = 1;
  let out = base;
  while (taken.has(out)) {
    n += 1;
    out = `${base}-${n}`;
  }
  taken.add(out);
  return out;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function dateWords(d) {
  const y = d.slice(0, 4);
  const m = Number(d.slice(5, 7));
  const day = Number(d.slice(8, 10));
  return `${day} ${MONTH_NAMES[m - 1]} ${y}`;
}

function countWords(text) {
  let n = 0;
  let inside = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const sp = c < 128 ? c === 32 || (c >= 9 && c <= 13) : c === 160 || c === 1680 || (c >= 8192 && c <= 8202) || c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279;
    if (sp) inside = false;
    else if (!inside) {
      inside = true;
      n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

const KNOWN_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const KEYVAL = /^([a-z_]+):(?: (.*))?$/;
const DATE_FMT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TPL_NAME = /^[a-z0-9-]+$/;
const SLUG_FMT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_OK = /^[^"[\]]+$/;

function daysOf(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return 31;
}

function readStr(raw) {
  if (raw.charAt(0) !== '"') {
    if (raw.charAt(0) === '[') return { error: 'a bare string opens on [' };
    return { value: raw };
  }
  if (raw.length < 2 || raw.charAt(raw.length - 1) !== '"') return { error: 'a quoted string is not closed' };
  let out = '';
  for (let i = 1; i < raw.length - 1; i += 1) {
    const c = raw[i];
    if (c === '\\') {
      const nx = raw[i + 1];
      if ((nx !== '"' && nx !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
      out += nx;
      i += 1;
    } else if (c === '"') {
      return { error: 'a quoted string holds a stray quote' };
    } else {
      out += c;
    }
  }
  return { value: out };
}

function checkVal(key, raw) {
  if (key === 'title' || key === 'summary') {
    const r = readStr(raw);
    if ('error' in r) return { error: `key "${key}": ${r.error}` };
    return r;
  }
  if (key === 'date') {
    const m = DATE_FMT.exec(raw);
    if (m === null) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysOf(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
    return { value: raw };
  }
  if (key === 'tags') {
    if (raw.charAt(0) !== '[' || raw.charAt(raw.length - 1) !== ']') return { error: 'key "tags": not a list [a, b]' };
    const inner = raw.slice(1, -1);
    if (inner.trim() === '') return { value: [] };
    const list = inner.split(',').map((t) => t.trim());
    for (const t of list) {
      if (t === '' || TAG_OK.test(t) === false) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
    }
    return { value: list };
  }
  if (key === 'draft') {
    if (raw === 'true') return { value: true };
    if (raw === 'false') return { value: false };
    return { error: 'key "draft": true or false' };
  }
  if (key === 'layout') {
    if (TPL_NAME.test(raw)) return { value: raw };
    return { error: 'key "layout": not a template name' };
  }
  if (key === 'slug') {
    if (SLUG_FMT.test(raw) && raw.length <= 64) return { value: raw };
    return { error: 'key "slug": not a slug' };
  }
  return { error: `unknown key "${key}"` };
}

function isBlankLn(line) {
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

function trimEnds(raw) {
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === ' ' || raw[end - 1] === '\t')) end -= 1;
  return raw.slice(0, end);
}

// { data, body } or { error }. The body is sliced out of the text.
function parseFM(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  const close = lines.indexOf('---', 1);
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i += 1) {
    const line = lines[i];
    if (isBlankLn(line) || line.charAt(0) === '#') continue;
    const m = KEYVAL.exec(line);
    if (m === null) return { error: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    const raw = trimEnds(m[2] === undefined ? '' : m[2]);
    if (KNOWN_KEYS.includes(key) === false) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = checkVal(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (Object.hasOwn(data, 'title') === false) return { error: 'no title' };
  return { data, body: lines.slice(close + 1).join('\n') };
}

// ---------------------------------------------------------------- markdown

const IS_BLANK = /^[ \t]*$/;
const FENCE_START = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_END = /^```[ \t]*$/;
const ATX = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const RULE = /^(?:---|\*\*\*)[ \t]*$/;
const BULLET_ITEM = /^[-*] (.*)$/;
const NUMBER_ITEM = /^(\d{1,9})\. (.*)$/;
const WRAPPED = /^ {2,}\S/;
const HAS_WS = /\s/;

const CAN_ESCAPE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);

function trimPad(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line[a] === ' ' || line[a] === '\t')) a += 1;
  while (b > a && (line[b - 1] === ' ' || line[b - 1] === '\t')) b -= 1;
  return a === 0 && b === line.length ? line : line.slice(a, b);
}

function atxOf(line) {
  const m = ATX.exec(line);
  if (m === null || m[2] === '') return null;
  return { depth: m[1].length, text: m[2] };
}

// Does `line` end a paragraph? A blank line, a fence, a heading or a break.
function closesPara(line) {
  const c = line.charAt(0);
  if (c === '' || c === ' ' || c === '\t') return IS_BLANK.test(line);
  if (c === '`') return FENCE_START.test(line);
  if (c === '#') return atxOf(line) !== null;
  if (c === '-' || c === '*') return RULE.test(line);
  return false;
}

// First index at or after `from` where `s` holds `what` outside an escape.
function seekRaw(s, what, from) {
  for (let j = from; j <= s.length - what.length; j += 1) {
    if (s[j] === '\\' && j + 1 < s.length && CAN_ESCAPE.has(s[j + 1])) {
      j += 1;
      continue;
    }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

// First lone `*` at or after `from` (one not part of a `**` pair).
function seekStar(s, from) {
  for (let j = from; j < s.length; j += 1) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && CAN_ESCAPE.has(s[j + 1])) {
      j += 1;
      continue;
    }
    if (c !== '*') continue;
    if (s[j + 1] === '*') {
      j += 1;
      continue;
    }
    return j;
  }
  return -1;
}

// Inline rendering. One native scan jumps from special to special; the
// plain stretch between two specials holds no escapable character, so it
// is pushed as it stands.
function span(s, env) {
  const buf = [];
  const scan = /[\\`*\[&<>"']/g;
  let from = 0;
  let m;
  while ((m = scan.exec(s)) !== null) {
    const j = m.index;
    const c = m[0];
    if (c === '&' || c === '<' || c === '>' || c === '"' || c === "'") {
      if (j > from) buf.push(s.slice(from, j));
      buf.push(FLIP[c]);
      from = j + 1;
      continue;
    }
    if (c === '\\') {
      const nx = s[j + 1];
      if (nx !== undefined && CAN_ESCAPE.has(nx)) {
        if (j > from) buf.push(s.slice(from, j));
        buf.push(nx);
        from = j + 2;
        scan.lastIndex = from;
      }
      continue;
    }
    if (c === '`') {
      const e = s.indexOf('`', j + 1);
      if (e > j + 1) {
        if (j > from) buf.push(s.slice(from, j));
        buf.push(`<code>${esc(s.slice(j + 1, e))}</code>`);
        from = e + 1;
        scan.lastIndex = from;
      }
      continue;
    }
    if (c === '*') {
      if (s[j + 1] === '*') {
        const e = seekRaw(s, '**', j + 2);
        if (e > j + 2) {
          if (j > from) buf.push(s.slice(from, j));
          buf.push(`<strong>${span(s.slice(j + 2, e), env)}</strong>`);
          from = e + 2;
          scan.lastIndex = from;
        } else {
          scan.lastIndex = j + 2;
        }
        continue;
      }
      const e = seekStar(s, j + 1);
      if (e > j + 1) {
        if (j > from) buf.push(s.slice(from, j));
        buf.push(`<em>${span(s.slice(j + 1, e), env)}</em>`);
        from = e + 1;
        scan.lastIndex = from;
      }
      continue;
    }
    const close = seekRaw(s, ']', j + 1);
    const paren = close !== -1 && s[close + 1] === '(' ? s.indexOf(')', close + 2) : -1;
    const target = paren === -1 ? '' : s.slice(close + 2, paren);
    if (target !== '' && HAS_WS.test(target) === false) {
      if (j > from) buf.push(s.slice(from, j));
      buf.push(`<a href="${esc(env.link(target))}">${span(s.slice(j + 1, close), env)}</a>`);
      from = paren + 1;
      scan.lastIndex = from;
    }
  }
  if (from < s.length) buf.push(s.slice(from));
  return buf.join('');
}

// Render one body to { html, toc, excerpt }. Blocks go straight to the
// output list; there is no token list in between.
function renderMD(src, env) {
  const lines = src.split('\n');
  const total = lines.length;
  const seen = new Set();
  const out = [];
  const toc = [];
  let firstPara = null;
  let i = 0;
  while (i < total) {
    const line = lines[i];
    const head = line.charAt(0);
    if (head === '' || head === ' ' || head === '\t') {
      if (IS_BLANK.test(line)) {
        i += 1;
        continue;
      }
    }
    if (head === '`') {
      const fence = FENCE_START.exec(line);
      if (fence !== null) {
        const lang = fence[1];
        const cls = lang === '' ? '' : ` class="language-${esc(lang)}"`;
        const parts = [`<pre><code${cls}>`];
        i += 1;
        while (i < total && FENCE_END.test(lines[i]) === false) {
          parts.push(`${esc(lines[i])}\n`);
          i += 1;
        }
        i += 1;
        parts.push('</code></pre>');
        out.push(parts.join(''));
        continue;
      }
    }
    if (head === '#') {
      const h = atxOf(line);
      if (h !== null) {
        const id = uniqSlug(toSlug(h.text), seen);
        const html = span(h.text, env);
        out.push(`<h${h.depth} id="${id}">${html}</h${h.depth}>`);
        if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
        i += 1;
        continue;
      }
    }
    if (head === '-' || head === '*') {
      if (RULE.test(line)) {
        out.push('<hr>');
        i += 1;
        continue;
      }
    }
    if (head === '>') {
      const rows = [];
      while (i < total && lines[i].charAt(0) === '>') {
        let l = lines[i].slice(1);
        if (l.charAt(0) === ' ') l = l.slice(1);
        rows.push(l);
        i += 1;
      }
      const kept = [];
      for (const l of rows) {
        const t = trimPad(l);
        if (t !== '') kept.push(t);
      }
      out.push(kept.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${span(kept.join('\n'), env)}</p>\n</blockquote>`);
      continue;
    }
    const bullet = head === '-' || head === '*' ? BULLET_ITEM.exec(line) : null;
    const numbered = bullet === null && head >= '0' && head <= '9' ? NUMBER_ITEM.exec(line) : null;
    if (bullet !== null || numbered !== null) {
      const ordered = numbered !== null;
      const marker = ordered ? NUMBER_ITEM : BULLET_ITEM;
      const start = ordered ? Number(numbered[1]) : 1;
      const items = [];
      while (i < total) {
        const mm = marker.exec(lines[i]);
        if (mm !== null) {
          items.push([trimPad(ordered ? mm[2] : mm[1])]);
          i += 1;
        } else if (WRAPPED.test(lines[i])) {
          items[items.length - 1].push(trimPad(lines[i]));
          i += 1;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      const open = ordered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      const parts = [`${open}\n`];
      for (const item of items) parts.push(`<li>${span(item.join('\n'), env)}</li>\n`);
      parts.push(`</${tag}>`);
      out.push(parts.join(''));
      continue;
    }
    const body = [trimPad(line)];
    i += 1;
    while (i < total && closesPara(lines[i]) === false) body.push(trimPad(lines[i++]));
    const html = span(body.join('\n'), env);
    if (firstPara === null) firstPara = html;
    out.push(`<p>${html}</p>`);
  }
  return { html: out.map((b) => `${b}\n`).join(''), toc, excerpt: firstPara === null ? '' : firstPara };
}

// ---------------------------------------------------------------- templates

const MAX_INCLUDE = 8;
const PATH_OK = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_TAG = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_TAG = /^if (not )?(\S+)$/;
const INC_TAG = /^include "([a-z0-9-]+)"$/;

class TplError extends Error {}

function splitPath(name, text) {
  if (PATH_OK.test(text) === false) throw new TplError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

// Split `src` into tokens: plain text, {{ }}, {{{ }}} and {% %}. A {% %}
// tag alone on its line takes the whole line with it, newline included.
function lexTpl(name, src) {
  const toks = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const nx = src[open + 1];
    if (nx !== '{' && nx !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (nx === '{') {
      const raw = src[open + 2] === '{';
      const shut = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (shut === -1) throw new TplError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') toks.push({ t: 'text', text });
      text = '';
      toks.push({ t: raw ? 'raw' : 'var', path: splitPath(name, src.slice(open + (raw ? 3 : 2), shut).trim()) });
      i = shut + (raw ? 3 : 2);
      continue;
    }
    const shut = src.indexOf('%}', open + 2);
    if (shut === -1) throw new TplError(`template "${name}": a {% is not closed`);
    const after = shut + 2;
    const ls = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', after);
    const le = nl === -1 ? src.length : nl;
    const alone = /^[ \t]*$/.test(src.slice(ls, open)) && /^[ \t]*$/.test(src.slice(after, le));
    if (alone) text = text.slice(0, text.length - (open - ls));
    if (text !== '') toks.push({ t: 'text', text });
    text = '';
    toks.push({ t: 'tag', tag: src.slice(open + 2, shut).trim() });
    i = alone ? (nl === -1 ? src.length : nl + 1) : after;
  }
  if (text !== '') toks.push({ t: 'text', text });
  return toks;
}

// Parse `src` into a node tree (a TplError when it does not parse).
function compileTpl(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of lexTpl(name, src)) {
    if (tok.t === 'text') {
      body.push({ kind: 'text', text: tok.text });
      continue;
    }
    if (tok.t === 'var' || tok.t === 'raw') {
      body.push({ kind: tok.t, path: tok.path });
      continue;
    }
    const tag = tok.tag;
    const top = stack[stack.length - 1];
    let m;
    if ((m = FOR_TAG.exec(tag)) !== null) {
      const node = { kind: 'for', name: m[1], path: splitPath(name, m[2]), body: [] };
      body.push(node);
      stack.push(node);
      body = node.body;
    } else if ((m = IF_TAG.exec(tag)) !== null) {
      const node = { kind: 'if', not: m[1] !== undefined, path: splitPath(name, m[2]), then: [], els: null };
      body.push(node);
      stack.push(node);
      body = node.then;
    } else if (tag === 'else') {
      if (top.kind !== 'if' || top.els !== null) throw new TplError(`template "${name}": an else outside an if`);
      top.els = [];
      body = top.els;
    } else if (tag === 'endfor' || tag === 'endif') {
      const want = tag === 'endfor' ? 'for' : 'if';
      if (top.kind !== want) throw new TplError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
      stack.pop();
      const par = stack[stack.length - 1];
      if (par.kind === 'root' || par.kind === 'for') body = par.body;
      else body = par.els === null ? par.then : par.els;
    } else if ((m = INC_TAG.exec(tag)) !== null) {
      body.push({ kind: 'include', name: m[1] });
    } else {
      throw new TplError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TplError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

// The value at `path` in the scope chain: the first name from the nearest
// scope that binds it, then each next name as an own property.
function fetch(scope, path) {
  let s = scope;
  while (s !== null && Object.hasOwn(s.vars, path[0]) === false) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k += 1) {
    if (v === null || typeof v !== 'object' || Object.hasOwn(v, path[k]) === false) return undefined;
    v = v[path[k]];
  }
  return v;
}

// A value as text: a string itself, a number in JavaScript's own digits,
// true or false, an array's items joined by ", ", anything else "".
function asText(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(asText).join(', ');
  return '';
}

// Whether a value counts as true in an if: not undefined, null, false,
// "", 0, or an empty array.
function isTrue(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

// Render `nodes` into the `buf` list (joined once by the caller).
function paint(nodes, scope, ctx, depth, buf) {
  for (let ni = 0; ni < nodes.length; ni += 1) {
    const n = nodes[ni];
    if (n.kind === 'text') {
      buf.push(n.text);
      continue;
    }
    if (n.kind === 'var') {
      buf.push(esc(asText(fetch(scope, n.path))));
      continue;
    }
    if (n.kind === 'raw') {
      buf.push(asText(fetch(scope, n.path)));
      continue;
    }
    if (n.kind === 'if') {
      const v = isTrue(fetch(scope, n.path));
      const branch = v !== n.not ? n.then : n.els;
      if (branch !== null) paint(branch, scope, ctx, depth, buf);
      continue;
    }
    if (n.kind === 'for') {
      const xs = fetch(scope, n.path);
      if (Array.isArray(xs) === false) continue;
      for (let k = 0; k < xs.length; k += 1) {
        const vars = { [n.name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === xs.length - 1, length: xs.length } };
        paint(n.body, { vars, parent: scope }, ctx, depth, buf);
      }
      continue;
    }
    const t = ctx.templates.get(n.name);
    if (t !== undefined && depth < MAX_INCLUDE) paint(t, scope, ctx, depth + 1, buf);
  }
}

// ---------------------------------------------------------------- build

const OWN_DIRS = ['posts', 'tags', 'page'];

function joinRel(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const parentDir = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

function neighbour(s) {
  if (s === null) return null;
  return { title: s.data.title, url: s.url, date: s.data.date === undefined ? '' : s.data.date, date_long: s.data.date === undefined ? '' : dateWords(s.data.date) };
}

export function run(input) {
  const base = input.site.base_url.replace(/\/+$/, '');
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(cmp);
  for (const name of names) {
    try {
      templates.set(name, compileTpl(name, input.templates[name]));
    } catch (err) {
      if (err instanceof TplError === false) throw err;
      report.push(err.message);
    }
  }

  // Sources, sorted by path in code-unit order; .md is a source, the rest
  // is static. Line ends of a source are made "\n" (only when needed).
  const ordered = [...input.files].sort((x, y) => cmp(x.path, y.path));
  const docs = [];
  const statics = [];
  for (const f of ordered) {
    if (f.path.endsWith('.md')) {
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      docs.push({ path: f.path, text });
    } else {
      statics.push({ path: f.path, content: f.content });
    }
  }

  // Front matter and the checks, in order: refused, generator's own
  // directory, post without a date, layout that is no template, draft.
  const kept = [];
  for (const doc of docs) {
    const fm = parseFM(doc.text);
    if ('error' in fm) {
      report.push(`refused ${doc.path}: ${fm.error}`);
      continue;
    }
    doc.data = fm.data;
    doc.body = fm.body;
    doc.post = doc.path.startsWith('posts/');
    let ownDir;
    for (const d of OWN_DIRS) {
      if (d !== 'posts' && doc.path.startsWith(`${d}/`)) {
        ownDir = d;
        break;
      }
    }
    if (ownDir !== undefined) {
      report.push(`refused ${doc.path}: ${ownDir}/ is the generator's own`);
      continue;
    }
    if (doc.post && Object.hasOwn(doc.data, 'date') === false) {
      report.push(`refused ${doc.path}: a post needs a date`);
      continue;
    }
    const layout = doc.data.layout === undefined ? (doc.post ? 'post' : 'page') : doc.data.layout;
    if (templates.has(layout) === false) {
      report.push(`refused ${doc.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    doc.layout = layout;
    if (doc.data.draft === true) {
      report.push(`draft ${doc.path}`);
      continue;
    }
    kept.push(doc);
  }

  // Permalinks: a post lives under posts/, a page under its own directory.
  // The slug is unique in its directory, in source order.
  const taken = new Map();
  const byPath = new Map();
  for (const doc of kept) {
    const dir = doc.post ? 'posts' : parentDir(doc.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? OWN_DIRS : []);
      taken.set(dir, set);
    }
    const slug = doc.data.slug === undefined ? toSlug(doc.data.title) : doc.data.slug;
    doc.slug = uniqSlug(slug, set);
    doc.outDir = dir === '' ? doc.slug : `${dir}/${doc.slug}`;
    doc.url = `${base}/${doc.outDir}/`;
    byPath.set(doc.path, doc);
  }

  // Markdown, with links resolved. A target that names no page and no
  // static file is a broken link, reported once and kept as written.
  const staticSet = new Set();
  for (const f of statics) staticSet.add(f.path);
  const broken = new Set();
  const linkMemo = new Map();
  for (const doc of kept) {
    const dir = parentDir(doc.path);
    const env = {
      link: (target) => {
        const key = `${dir} ${target}`;
        const hit = linkMemo.get(key);
        if (hit !== undefined) {
          if (hit.broken) broken.add(`broken-link ${doc.path} -> ${target}`);
          return hit.href;
        }
        let href;
        let isBroken = false;
        if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) {
          href = target;
        } else {
          const hash = target.indexOf('#');
          const rel = hash === -1 ? target : target.slice(0, hash);
          const frag = hash === -1 ? '' : target.slice(hash);
          const path = rel === '' ? null : joinRel(dir, rel);
          if (path !== null && byPath.has(path)) href = `${byPath.get(path).url}${frag}`;
          else if (path !== null && staticSet.has(path)) href = `${base}/${path}${frag}`;
          else {
            href = target;
            isBroken = true;
          }
        }
        linkMemo.set(key, { href, broken: isBroken });
        if (isBroken) broken.add(`broken-link ${doc.path} -> ${target}`);
        return href;
      },
    };
    const md = renderMD(doc.body, env);
    doc.html = md.html;
    doc.toc = md.toc;
    doc.excerpt = md.excerpt;
    doc.minutes = Math.max(1, Math.ceil(countWords(doc.body) / 200));
  }

  // Collections: posts newest first, equal dates by slug. Each post's
  // newer is the one before it, its older the one after.
  const posts = [];
  for (const doc of kept) if (doc.post) posts.push(doc);
  posts.sort((x, y) => cmp(y.data.date, x.data.date) || cmp(x.slug, y.slug));
  for (let k = 0; k < posts.length; k += 1) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // Tags: each post's tags, each slug once, in its own order. A tag is
  // named as first met walking the posts in collection order, and ordered
  // by its count of posts, most first, then by slug.
  const bySlug = new Map();
  const ownTagNames = (doc) => {
    const seen = new Set();
    const out = [];
    const tags = doc.data.tags === undefined ? [] : doc.data.tags;
    for (const name of tags) {
      const slug = toSlug(name);
      if (seen.has(slug) === false) {
        seen.add(slug);
        out.push(name);
      }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTagNames(p)) {
      const slug = toSlug(name);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const doc of kept) {
    if (doc.post) continue;
    doc.tagRefs = ownTagNames(doc).map((name) => {
      const slug = toSlug(name);
      const found = bySlug.get(slug);
      return found === undefined ? { name, slug, url: '', posts: [] } : found;
    });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || cmp(x.slug, y.slug));

  // What templates see: a card, a page, a tag, the site, the tag list and
  // the recent posts.
  const cardOf = (doc) => ({
    title: doc.data.title,
    url: doc.url,
    date: doc.data.date === undefined ? '' : doc.data.date,
    date_long: doc.data.date === undefined ? '' : dateWords(doc.data.date),
    summary: doc.data.summary === undefined ? '' : doc.data.summary,
    excerpt: doc.excerpt,
    reading_minutes: doc.minutes,
    tags: doc.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const cards = new Map();
  for (const p of posts) cards.set(p, cardOf(p));
  const pageOf = (doc) => {
    const card = cardOf(doc);
    card.slug = doc.slug;
    card.content = doc.html;
    card.toc = doc.toc.map((h) => ({ level: h.level, id: h.id, html: h.html }));
    card.newer = neighbour(doc.newer === undefined ? null : doc.newer);
    card.older = neighbour(doc.older === undefined ? null : doc.older);
    card.is_post = doc.post;
    return card;
  };

  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const ctx = { templates };
  const output = {};
  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const buf = [];
    const scope = { vars: { site, tags: allTags, recent, ...vars }, parent: null };
    paint(nodes, scope, ctx, 0, buf);
    return buf.join('');
  };
  for (const doc of kept) output[`${doc.outDir}/index.html`] = render(doc.layout, { page: pageOf(doc) });
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k += 1) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // The report: every refusal, draft, broken link and template that did
  // not parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(cmp);
  let pageCount = 0;
  for (const doc of kept) if (doc.post === false) pageCount += 1;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
