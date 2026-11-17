// Ask 5/7: a page of the app to its code, by plain code. A person pastes the address of the page they are looking at
// ("http://localhost:4204/pazienti/12") or names its path ("/scadenze"), or an API path ("/api/due"), and gets in a
// second the route, the Angular component and its files, the components inside it, the API calls they make, the Spring
// controller method that answers each call (file and line), the Insights component, who knows it and its latest bugs.
// Parsing, not compiling: Angular route literals (loadComponent, component, loadChildren, children, redirectTo),
// HttpClient calls with a literal or template URL, Spring @RequestMapping / @GetMapping…; anything it cannot read is
// left out and said, and a page it cannot match goes the full way (Claude).

const ROUTE_FILE = /(^|\/)(app\.routes|[\w.-]*\.routes|app-routing\.module|[\w.-]*-routing\.module)\.ts$/;
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const base = (p) => String(p).split('/').pop();
const dirOf = (p) => String(p).split('/').slice(0, -1).join('/');

/** A relative import from `from` ("./x/y.component") as a repository path, with ".ts" when it has none. */
export function resolveImport(from, spec) {
  if (!/^\.\.?\//.test(spec)) return null; // a package, not a file of the app
  const parts = dirOf(from).split('/').filter(Boolean);
  for (const seg of spec.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  const path = parts.join('/');
  return /\.(ts|js|mjs)$/.test(path) ? path : `${path}.ts`;
}

/** The top-level `{ … }` objects of an array literal's text (strings and template literals skipped). */
function objectsIn(text) {
  const out = [];
  let depth = 0;
  let start = -1;
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}

/** The text of the array that follows `at` ("[" … the matching "]"). */
function arrayAt(text, at) {
  const open = text.indexOf('[', at);
  if (open < 0) return '';
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return text.slice(open + 1, i);
  }
  return '';
}

/** A route object's own text, without its children (so "path:" of a child is not taken for its own). */
const ownText = (obj) => {
  const at = obj.search(/\bchildren\s*:/);
  if (at < 0) return obj;
  const open = obj.indexOf('[', at);
  return obj.slice(0, at) + obj.slice(open + arrayAt(obj, at).length + 2);
};

/**
 * The routes of an Angular app, flattened with their full paths: { path, file, name, redirectTo, routesFile }.
 * @param {string} file   the routes file (frontend/src/app/app.routes.ts)
 * @param {(path: string) => string|null} read  a file of the repository, or null
 */
export function parseRoutes(file, read, prefix = '', seen = new Set()) {
  const text = read(file);
  if (!text || seen.has(file)) return [];
  seen.add(file);
  const imports = new Map(); // ClassName → its file
  for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean)) imports.set(name, resolveImport(file, m[2]));
  }
  const at = text.search(/(?:Routes\s*=|RouterModule\.for(?:Root|Child)\s*\(|provideRouter\s*\()\s*\[?/);
  const list = at < 0 ? '' : arrayAt(text, at);
  const walk = (arrText, pre) => objectsIn(arrText).flatMap((obj) => {
    const own = ownText(obj);
    const path = own.match(/\bpath\s*:\s*['"`]([^'"`]*)['"`]/)?.[1];
    if (path === undefined) return [];
    const full = [pre, path].filter(Boolean).join('/');
    const out = [];
    const lazy = own.match(/loadComponent\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)(?:\s*\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\2\.(\w+)\s*\))?/);
    const direct = own.match(/\bcomponent\s*:\s*(\w+)/);
    const redirect = own.match(/redirectTo\s*:\s*['"`]([^'"`]*)['"`]/)?.[1];
    if (lazy) out.push({ path: full, file: resolveImport(file, lazy[1]), name: lazy[3] ?? null, routesFile: file });
    else if (direct) out.push({ path: full, file: imports.get(direct[1]) ?? null, name: direct[1], routesFile: file });
    else if (redirect !== undefined) out.push({ path: full, redirectTo: redirect, routesFile: file });
    const children = own.match(/loadChildren\s*:\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]\s*\)/);
    if (children) out.push(...parseRoutes(resolveImport(file, children[1]), read, full, seen));
    const kids = obj.search(/\bchildren\s*:/);
    if (kids >= 0) out.push(...walk(arrayAt(obj, kids), full));
    return out;
  });
  return walk(list, prefix);
}

/** The route a path is on: static segments first, then ":param", then "**". Follows a redirect once. */
export function matchRoute(routes, urlPath) {
  const segs = String(urlPath).split(/[?#]/)[0].split('/').filter(Boolean).map(decodeURIComponent);
  const score = (r) => {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length === 1 && rs[0] === '**') return 1;
    if (rs.length !== segs.length) return -1;
    let s = 2;
    for (let i = 0; i < rs.length; i++) {
      if (rs[i].startsWith(':')) s += 1;
      else if (rs[i].toLowerCase() === segs[i].toLowerCase()) s += 3;
      else return -1;
    }
    return s;
  };
  const best = routes.map((r) => ({ r, s: score(r) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s)[0]?.r ?? null;
  if (best?.redirectTo !== undefined && best.redirectTo !== null) {
    const target = routes.find((r) => r.path === best.redirectTo.replace(/^\//, '') && r.file);
    return target ? { ...target, redirectedFrom: best.path } : null;
  }
  return best;
}

const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'super', 'new', 'else']);
/** The class methods of a file and where each starts: the method an HTTP call is in. */
function methodsOf(text) {
  return [...String(text).matchAll(/^[ \t]+(?:(?:public|private|protected|readonly|static|async|override)\s+)*(\w+)\s*(?:<[^>()]*>)?\s*\([^)]*\)\s*(?::\s*[^{;=]+)?\{/gm)]
    .filter((m) => !NOT_METHODS.has(m[1]))
    .map((m) => ({ name: m[1], at: m.index }));
}

/** HttpClient calls of a file: GET /api/x, POST …/doses, with the method they are in; `${id}` becomes "{…}". */
export function httpCalls(text) {
  const out = [];
  const methods = methodsOf(text);
  for (const m of String(text).matchAll(/\.(get|post|put|patch|delete)\s*(?:<[^()`'"]*>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) {
    const raw = m[2].slice(1, -1);
    // A leading constant (`${API}/patients`) is the API base: matched by the rest of the path.
    const lead = /^\$\{[^}]+\}/.test(raw);
    const path = raw.replace(/^\$\{[^}]+\}/, '').replace(/\$\{[^}]+\}/g, '{…}').split('?')[0];
    if (!path.startsWith('/')) continue;
    const inMethod = methods.filter((x) => x.at < m.index).at(-1)?.name ?? null;
    out.push({ method: m[1].toUpperCase(), path, anyPrefix: lead, line: String(text).slice(0, m.index).split('\n').length, inMethod });
  }
  return out;
}

/** The endpoints of a Spring controller: { method, path, handler, line }. */
export function springEndpoints(text) {
  const src = String(text);
  const cls = src.search(/\bclass\s+\w+/);
  const classMap = src.slice(0, cls < 0 ? src.length : cls).match(/@RequestMapping\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)"/)?.[1] ?? '';
  const out = [];
  const re = /@(Get|Post|Put|Patch|Delete|Request)Mapping\b(\(([^)]*)\))?/g;
  for (const m of src.matchAll(re)) {
    if (m.index < cls) continue; // the class-level mapping
    const args = m[3] ?? '';
    const sub = args.match(/(?:^|\b(?:value|path)\s*=\s*)\{?\s*"([^"]*)"/)?.[1] ?? args.match(/^\s*"([^"]*)"/)?.[1] ?? '';
    const method = m[1] === 'Request' ? (args.match(/RequestMethod\.(\w+)/)?.[1] ?? 'ANY') : m[1].toUpperCase();
    const after = src.slice(m.index + m[0].length);
    const decl = after.match(/^[\s\S]*?\b(?:public|protected|private)?\s*(?:static\s+)?[\w<>[\], ?.]+\s+(\w+)\s*\(/);
    out.push({ method, path: `${classMap}${sub}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1') || '/', handler: decl?.[1] ?? null, line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const shape = (p) => String(p).replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '').toLowerCase();
/** Whether a frontend call and a backend endpoint are the same: same method, same path (the call's base may be a constant). */
export function sameEndpoint(call, ep) {
  if (ep.method !== 'ANY' && call.method !== ep.method) return false;
  const a = shape(call.path);
  const b = shape(ep.path);
  return a === b || (call.anyPrefix && b.endsWith(a) && b.length > a.length);
}

/**
 * Where an address points: { kind: 'page', port, path } or { kind: 'api', port, path }, or null. An address of the
 * app (http…), or a path ("/scadenze", "/api/due") written as one word.
 */
export function pageInQuestion(question) {
  const q = String(question ?? '');
  const url = q.match(/https?:\/\/[^\s"'<>)]+/i)?.[0];
  if (url) {
    try {
      const u = new URL(url.replace(/[.,;:!?]+$/, ''));
      const path = u.pathname === '/' && u.hash.startsWith('#/') ? u.hash.slice(1) : u.pathname; // hash routing
      return { kind: /^\/api(\/|$)/.test(path) ? 'api' : 'page', port: u.port ? Number(u.port) : null, path: path.replace(/\/+$/, '') || '/' };
    } catch {
      return null;
    }
  }
  const bare = q.match(/(?:^|[\s"'(])(\/[a-z0-9][\w\-/:.{}]*)/i)?.[1];
  if (!bare || /\.(ts|java|html|scss|md|json|sql)$/i.test(bare)) return null; // a file, not a page
  const path = bare.replace(/[.,;:!?]+$/, '').replace(/\/+$/, '');
  return { kind: /^\/api(\/|$)/.test(path) ? 'api' : 'page', port: null, path };
}

// Words that ask for a cause, not for the code's map: such a question goes to Claude, with the trace as a hint.
const WHY = /\b(why|wrong|error|bug|broken|fail\w*|crash\w*|doesn ?t|does not|not work\w*|zasto|ne radi|gres\w*|pogres\w*|perche|non funziona|errore|sbagliat\w*|non va)\b/;
/** Whether a question with an address only asks for its code ("which code is behind /scadenze?"), not why it misbehaves. */
export function pageOnly(question) {
  const rest = String(question ?? '').replace(/https?:\/\/\S+/gi, ' ').replace(/(^|\s)\/[\w\-/:.{}]+/g, ' ');
  const words = rest.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[’']/g, ' ');
  return !WHY.test(words) && words.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length <= 12;
}

/**
 * The trace of a page or an API path through the code. `read` gives a file of main (async), `files` the list of
 * main. Returns null when the address matches nothing: the question then goes the full way.
 */
export async function traceAddress({ where, files, read, maxChildren = 6 }) {
  const texts = new Map();
  const get = async (f) => {
    if (!f) return null;
    if (!texts.has(f)) texts.set(f, files.includes(f) ? await read(f).catch(() => null) : null);
    return texts.get(f);
  };
  // Many small reads (a git show each): eight at a time, not one after the other (4 s cold → about 1 s).
  const prefetch = async (list) => {
    const queue = [...list];
    await Promise.all(Array.from({ length: Math.min(8, queue.length) }, async () => {
      while (queue.length) await get(queue.shift());
    }));
  };
  const appTs = files.filter((f) => /^frontend\/src\/app\/.+\.ts$/.test(f) && !/\.spec\.ts$/.test(f));
  const controllers = files.filter((f) => /^backend\/src\/main\/.+(Controller|Resource)\.java$/.test(f));
  await prefetch([...controllers, ...(where.kind === 'api' ? appTs : appTs.filter((f) => ROUTE_FILE.test(f)))]);
  const endpoints = [];
  for (const f of controllers) for (const e of springEndpoints((await get(f)) ?? '')) endpoints.push({ ...e, file: f });
  const answerOf = (call) => endpoints.find((e) => sameEndpoint(call, e)) ?? null;

  if (where.kind === 'api') {
    // "/api/patients/12/card" and "/api/patients/{id}/card" are both /api/patients/{}/card.
    const want = shape(where.path);
    const eps = endpoints.filter((e) => new RegExp(`^${shape(e.path).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{\}/g, '[^/]+')}$`).test(want));
    if (!eps.length) return null;
    const callers = [];
    for (const f of appTs) {
      for (const c of httpCalls((await get(f)) ?? '')) if (eps.some((e) => sameEndpoint(c, e))) callers.push({ file: f, ...c });
    }
    // A call in a service: the classes that use that method of it (the page behind the service).
    for (const c of callers) {
      const cls = ((await get(c.file)) ?? '').match(/export\s+class\s+(\w+)/)?.[1];
      if (!cls || !c.inMethod || !INJECTABLE.test(cls)) continue;
      c.usedBy = [];
      for (const f of appTs) {
        const t = (await get(f)) ?? '';
        if (f !== c.file && new RegExp(`\\b${cls}\\b`).test(t) && new RegExp(`\\.${c.inMethod}\\s*\\(`).test(t)) c.usedBy.push(f);
      }
    }
    return { kind: 'api', path: where.path, endpoints: eps, callers };
  }

  // A page: the route, its component and what is inside it.
  const routeFiles = appTs.filter((f) => ROUTE_FILE.test(f)).sort((a, b) => a.length - b.length);
  for (const f of routeFiles) await get(f);
  for (const f of appTs.filter((x) => /\.routes\.ts$/.test(x))) await get(f); // lazy children
  const routes = routeFiles.length ? parseRoutes(routeFiles[0], (f) => texts.get(f) ?? null) : [];
  const route = matchRoute(routes, where.path);
  if (!route?.file) return null;
  const component = await componentOf(route.file, route.name, get);
  if (!component) return null;
  const children = [];
  for (const c of component.children.slice(0, maxChildren)) {
    const child = await componentOf(c.file, c.name, get);
    if (child) children.push(child);
  }
  const calls = [component, ...children].flatMap((c) => c.calls.map((call) => ({ ...call, from: c.name, endpoint: answerOf(call) })));
  return { kind: 'page', path: where.path, route, component, children, calls, routesFile: routeFiles[0], routes: routes.length };
}

/** One component: its files (ts, template, styles), the services it imports, the components inside it, its HTTP calls. */
async function componentOf(file, name, get) {
  const text = await get(file);
  if (!text) return null;
  const className = name ?? text.match(/export\s+class\s+(\w+)/)?.[1] ?? base(file);
  const own = [file];
  const template = text.match(/templateUrl\s*:\s*['"]([^'"]+)['"]/)?.[1];
  if (template) own.push(resolveImport(file, template).replace(/\.ts$/, ''));
  for (const s of [...(text.match(/styleUrls?\s*:\s*(\[[^\]]*\]|['"][^'"]+['"])/)?.[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)]) own.push(resolveImport(file, s[1]).replace(/\.ts$/, ''));
  const imports = importsOf(file, text);
  const declared = text.match(/imports\s*:\s*\[([^\]]*)\]/)?.[1] ?? '';
  const children = imports.filter((i) => /Component$/.test(i.name) && new RegExp(`\\b${i.name}\\b`).test(declared));
  const services = [];
  const calls = [...httpCalls(text).map((c) => ({ ...c, file })), ...(await dataOf(file, text, get, services, new Set([file])))];
  return { name: className, file, files: own, inlineTemplate: !template && /\btemplate\s*:/.test(text), services, children, calls };
}

const importsOf = (file, text) => [...String(text).matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)].flatMap((m) => m[1].split(',').map((n) => ({ name: n.trim().split(/\s+as\s+/).pop(), file: resolveImport(file, m[2]) })).filter((i) => i.name));
const INJECTABLE = /(Service|Store|Facade|Api|Client|Gateway|Repository)$/;

/**
 * The API calls behind a class, through what it injects (a service, or a store that uses a service; three levels at
 * most). Of a service's calls, only those in methods the caller uses: the patient card does not search patients
 * because the service it uses can.
 */
async function dataOf(file, text, get, services, seen, depth = 1) {
  const body = String(text).replace(/^import[^;]+;/gm, '');
  const out = [];
  for (const dep of importsOf(file, text).filter((i) => INJECTABLE.test(i.name) && new RegExp(`\\b${i.name}\\b`).test(body))) {
    if (seen.has(dep.file)) continue;
    seen.add(dep.file);
    const st = await get(dep.file);
    if (!st) continue;
    const own = httpCalls(st).filter((c) => !c.inMethod || new RegExp(`\\.${c.inMethod}\\s*\\(`).test(body)).map((c) => ({ ...c, file: dep.file, via: dep.name }));
    const deeper = depth < 3 ? await dataOf(dep.file, st, get, services, seen, depth + 1) : [];
    if (own.length || deeper.length) services.push({ name: dep.name, file: dep.file, calls: own.length });
    out.push(...own, ...deeper);
  }
  return out;
}

/**
 * The answer, in words, with its sources: files and controller lines as links, the component's latest bugs.
 * @param {object} p.insights  the Insights data (components, tickets), for who knows it and its bugs
 */
export function pageAnswer({ question, trace, rules = [], insights = null, ticketUrl = () => null, fileUrl = () => null }) {
  const fileSource = (path, why, line = null) => ({ type: 'file', ref: line ? `${path}:${line}` : path, url: fileUrl(path) ? `${fileUrl(path)}${line ? `#L${line}` : ''}` : null, why });
  const sources = [];
  const parts = [];
  const ownerOf = (paths) => {
    const names = [...new Set(paths.map((f) => rules.find((r) => (r.paths ?? []).some((p) => f.startsWith(p)))?.name).filter(Boolean))];
    return names.length === 1 ? names[0] : null;
  };
  const ep = (e) => `${e.handler ? `${base(e.file).replace(/\.java$/, '')}.${e.handler}` : base(e.file)} (${e.file}:${e.line})`;
  let paths = [];
  if (trace.kind === 'api') {
    parts.push(`${trace.path} is answered by ${trace.endpoints.map((e) => `${e.method} ${e.path} → ${ep(e)}`).join('; ')}.`);
    for (const e of trace.endpoints) sources.push(fileSource(e.file, `${e.method} ${e.path}`, e.line));
    if (trace.callers.length) {
      parts.push(`Called by ${[...new Map(trace.callers.map((c) => [`${c.file}:${c.line}`, `${c.file}:${c.line}${c.inMethod ? ` (${c.inMethod}())` : ''}${c.usedBy?.length ? `, used by ${c.usedBy.map(base).join(', ')}` : ''}`])).values()].join('; ')}.`);
      for (const c of trace.callers.slice(0, 4)) sources.push(fileSource(c.file, `${c.method} ${c.path}`, c.line));
      for (const f of [...new Set(trace.callers.flatMap((c) => c.usedBy ?? []))].slice(0, 4)) sources.push(fileSource(f, `uses it`));
    } else parts.push('No page of the app calls it (a call the code builds another way is not seen).');
    paths = [...trace.endpoints.map((e) => e.file), ...trace.callers.map((c) => c.file)];
  } else {
    const c = trace.component;
    const r = trace.route;
    parts.push(`The page ${trace.path} is the route "${r.path}"${r.redirectedFrom !== undefined ? ` (redirected from "${r.redirectedFrom}")` : ''}: ${c.name} in ${c.file}${c.files.length > 1 ? ` (with ${c.files.slice(1).map(base).join(', ')})` : c.inlineTemplate ? ' (its template is inline)' : ''}.`);
    sources.push(fileSource(c.file, `the component of the route "${r.path}"`));
    for (const f of c.files.slice(1)) sources.push(fileSource(f, `${c.name}: template or style`));
    if (trace.children.length) {
      parts.push(`Inside it: ${trace.children.map((x) => `${x.name} (${x.file})`).join(', ')}.`);
      for (const x of trace.children) sources.push(fileSource(x.file, `inside ${c.name}`));
    }
    if (trace.calls.length) {
      const seen = new Set();
      const lines = trace.calls.filter((k) => !seen.has(`${k.method} ${k.path}`) && seen.add(`${k.method} ${k.path}`)).map((k) => `${k.method} ${k.endpoint ? k.endpoint.path : `…${k.path}`}${k.via ? ` (${k.via})` : k.from !== c.name ? ` (${k.from})` : ''} → ${k.endpoint ? ep(k.endpoint) : 'no backend method found'}`);
      parts.push(`Its data: ${lines.join('; ')}.`);
      for (const s of [...new Map([...c.services, ...trace.children.flatMap((x) => x.services)].map((s) => [s.file, s])).values()]) sources.push(fileSource(s.file, `${s.name}: the API calls`));
      for (const e of [...new Map(trace.calls.filter((k) => k.endpoint).map((k) => [`${k.endpoint.file}:${k.endpoint.line}`, k.endpoint])).values()]) sources.push(fileSource(e.file, `${e.method} ${e.path}`, e.line));
    } else parts.push('It calls no API itself.');
    paths = [c.file, ...trace.children.map((x) => x.file), ...trace.calls.filter((k) => k.endpoint).map((k) => k.endpoint.file)];
  }
  const component = ownerOf(trace.kind === 'page' ? [trace.component.file] : paths);
  const comp = component ? (insights?.components ?? []).find((x) => x.name === component) : null;
  if (component) parts.push(`Component: ${component}.`);
  if (comp?.team?.length) parts.push(`Who knows it: ${comp.team.slice(0, 3).map((p) => `${p.name} (${p.share} %)`).join(', ')}.`);
  const bugs = component ? (insights?.tickets ?? []).filter((t) => /bug/i.test(t.type ?? '') && (t.components ?? []).includes(component)).sort((a, b) => Number(b.key.split('-')[1]) - Number(a.key.split('-')[1])).slice(0, 3) : [];
  if (bugs.length) {
    parts.push(`Its latest bugs: ${bugs.map((t) => `${t.key} ${clean(t.summary)} (${t.status})`).join('; ')}.`);
    for (const t of bugs) sources.push({ type: 'ticket', ref: t.key, url: ticketUrl(t.key), why: `${t.type}, ${t.status}: ${t.summary}` });
  }
  return { question, found: true, fast: true, intent: 'page', component, answer: parts.join(' '), sources };
}
