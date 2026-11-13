// Entries stay true (K7 of docs/KNOWLEDGE_PLAN.md). Plain code, no AI:
//   - an entry that cites commits which are not on main (the agent's fix branch, squash-merged and deleted) gets the
//     commit that brought the ticket onto main: "Merged into main as bc4c699." on its Fix line;
//   - an entry gets its **Test** line (KB1): the regression tests of its fix on main, or "none"; a "none" is filled in
//     once the fix with its test is on main;
//   - an entry whose cited files no longer exist on main is stale: someone should check it (renamed, moved, removed).

import { hashesIn, parseKnowledgeFile } from './knowledge.mjs';
import { NONE, withTestField } from './knowledge-tests.mjs';

const PATH_RE = /[\w@.-]+(?:\/[\w@.-]+)+\.(?:ts|java|scss|css|html|sql|json|xml|properties|ya?ml|md)\b/g;

/**
 * @param {{ file: string, text: string }[]} files   docs/knowledge/*.md (README.md is skipped)
 * @param {object} repo
 * @param {(hash: string) => boolean} repo.onMain          the commit is reachable from main
 * @param {(key: string) => string | null} repo.mainCommitFor  the newest commit on main that names the ticket
 * @param {(path: string) => boolean} repo.fileExists      the path exists on main
 * @param {(key: string) => string | null} [repo.testLineFor]  the ticket's **Test** value (knowledge-tests.mjs testLine);
 *   null = not known, the Test line is left as it is
 * @returns {{ edits: Map<string, string>, merged: object[], tests: object[], stale: object[] }}
 */
export function planRefresh(files, { onMain, mainCommitFor, fileExists, testLineFor = () => null }) {
  const edits = new Map();
  const merged = [];
  const tests = [];
  const stale = [];
  for (const { file, text } of files.filter((f) => !/README\.md$/.test(f.file))) {
    let lines = String(text).replace(/\r/g, '').split('\n');
    for (const e of parseKnowledgeFile(text, file).entries.filter((x) => !x.reference)) {
      const away = hashesIn(e.text).filter((h) => !onMain(h));
      const main = away.length ? mainCommitFor(e.key) : null;
      if (main && !e.text.includes(main.slice(0, 7))) {
        // The entry's own Fix line: the first "- **Fix**" after its heading.
        const head = lines.findIndex((l) => l.startsWith(`### ${e.key}:`));
        const fix = head < 0 ? -1 : lines.findIndex((l, i) => i > head && /^- \*\*Fix\*\*/.test(l));
        const next = head < 0 ? -1 : lines.findIndex((l, i) => i > head && /^#{1,3} /.test(l));
        if (fix > 0 && (next < 0 || fix < next)) {
          lines[fix] = `${lines[fix].replace(/\s+$/, '')}${/[.:]$/.test(lines[fix].trim()) ? '' : '.'} Merged into main as ${main.slice(0, 7)}.`;
          merged.push({ key: e.key, file, away, mergedAs: main.slice(0, 7) });
        }
      }
      const missing = [...new Set(e.text.match(PATH_RE) ?? [])].filter((p) => !/^(docs|e2e\/tests)\//.test(p) && !fileExists(p));
      if (missing.length) stale.push({ key: e.key, title: e.title, file, anchor: e.anchor, missing });
    }
    let out = lines.join('\n');
    for (const e of parseKnowledgeFile(out, file).entries.filter((x) => !x.reference)) {
      const value = testLineFor(e.key);
      const now = e.fields.Test?.trim() ?? null;
      // Added when missing; a "none" replaced once tests exist; a named list is a person's or the code's: kept.
      if (value && (!now || (/^none\b/i.test(now) && value !== NONE))) {
        out = withTestField(out, e.key, value);
        tests.push({ key: e.key, file, value, was: now });
      }
    }
    if (out !== String(text).replace(/\r/g, '')) edits.set(file, out);
  }
  return { edits, merged, tests, stale };
}
