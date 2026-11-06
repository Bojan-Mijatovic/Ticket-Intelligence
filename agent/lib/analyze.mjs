// Runs the analyze-ticket skill headless (claude -p) for one ticket and returns a validated, structured result.
// The agent only reads and analyzes: file-editing tools are disabled and the prompt forbids any write action.
// Actions (Jira comment, labels, notifications) are executed afterwards by the watcher, according to policy.json.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED = ['ticket', 'summary', 'likelyCause', 'confidence', 'component', 'proposedFix', 'owner', 'escalate', 'nextSteps', 'jiraComment', 'handoff'];

export function buildPrompt(key, workDir) {
  return `You are running unattended: no human will read your intermediate messages or answer questions.

Analyze Jira ticket ${key} for the project in the current directory, using the analyze-ticket skill (follow its steps 1–3).
- Use "${workDir}" as your scratch directory (for --out and --attachments-dir).
- Read-only: do NOT post Jira comments, change Jira, edit or create project files, commit, or ask questions. Skip the skill's drafts/offers/approval steps; the result below replaces them.
- Open the relevant source files before proposing a fix, as the skill says.

When you are done, reply with ONLY one \`\`\`json fenced block, nothing else, matching exactly this shape (all text in English):
{
  "ticket": "${key}",
  "title": "ticket summary",
  "summary": "2-3 sentences: what is broken, for whom, what it blocks",
  "likelyCause": "the hypothesis, with evidence (ticket keys, commit hashes, file:line)",
  "confidence": "high | medium | low",
  "component": "main code component path",
  "files": ["path:line", "..."],
  "relatedTickets": [{ "key": "…", "why": "one line" }],
  "duplicateOf": null or { "key": "an open ticket reporting the same problem", "why": "one line" },
  "proposedFix": "concrete change: file, what to change, how to verify",
  "owner": { "name": "best person", "why": "evidence: tickets / commits" },
  "alternatives": [{ "name": "…", "why": "…" }],
  "escalate": { "yes": true, "reason": "which rule" },
  "nextSteps": ["step — owner", "…"],
  "jiraComment": "internal Jira comment in Jira wiki markup (h3. headings, *bold*, {{code}}, '* ' bullets), max 3500 characters, hypotheses labelled as such",
  "handoff": { "to": "owner name", "message": "Teams-ready message to the owner, max 120 words" },
  "reporterReply": "short reply to the reporter, no internal names or speculation, no ETA"
}`;
}

function extractJson(text) {
  const blocks = [...String(text).matchAll(/```json\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidate = blocks.at(-1) ?? String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1);
  return JSON.parse(candidate);
}

function describeTool(name, input = {}) {
  if (name === 'Bash' || name === 'PowerShell') {
    const cmd = String(input.command ?? '');
    const sub = cmd.match(/ticket\.mjs"?\s+(\w+)/)?.[1];
    return sub ? `ticket.mjs ${sub}` : `shell: ${cmd.slice(0, 80)}`;
  }
  if (name === 'Read') return `read ${String(input.file_path ?? '').split(/[\\/]/).slice(-3).join('/')}`;
  if (name === 'Grep') return `search "${input.pattern}"`;
  if (name === 'Glob') return `find ${input.pattern}`;
  if (name === 'Skill') return `skill ${input.skill}`;
  return name;
}

/**
 * Runs `claude -p` headless in `cwd` and returns the parsed JSON block of its final answer.
 * The prompt goes through stdin: on Windows the CLI is a .cmd shim run through cmd.exe, which cannot pass
 * multi-line arguments.
 * @returns {Promise<{ result: object, meta: { costUsd: number, durationMs: number, turns: number } }>}
 */
export async function runClaude(opts) {
  const { required = [], transcriptFile } = opts;
  const first = await invokeClaude(opts);
  let final = first.final;
  let transcript = first.transcript;
  let parsed = parseResult(final, required);

  // An invalid or incomplete JSON answer is corrected in the SAME session (--resume): the agent keeps all its
  // context, so nothing is redone. One correction attempt only.
  if (parsed.error && final.session_id) {
    const again = await invokeClaude({
      ...opts,
      resume: final.session_id,
      prompt: `Your last reply could not be used: ${parsed.error}. Reply again with ONLY the \`\`\`json block, as valid JSON (commas between properties, quotes escaped inside strings), with all the required fields: ${required.join(', ')}. Do not run any tools.`,
    });
    transcript = [...transcript, ...again.transcript];
    final = { ...again.final, total_cost_usd: (first.final.total_cost_usd ?? 0) + (again.final.total_cost_usd ?? 0), duration_ms: (first.final.duration_ms ?? 0) + (again.final.duration_ms ?? 0), num_turns: (first.final.num_turns ?? 0) + (again.final.num_turns ?? 0) };
    parsed = parseResult(again.final, required);
  }
  if (transcriptFile) writeFileSync(transcriptFile, transcript.map((e) => JSON.stringify(e)).join('\n'));
  if (parsed.error) throw new Error(parsed.error);
  return { result: parsed.result, meta: { costUsd: final.total_cost_usd ?? 0, durationMs: final.duration_ms ?? 0, turns: final.num_turns ?? 0 } };
}

function parseResult(final, required) {
  if (final.is_error) return { error: `claude reported an error: ${String(final.result ?? final.subtype).slice(0, 300)}` };
  let result;
  try {
    result = extractJson(final.result);
  } catch (e) {
    return { error: `the JSON answer is not valid (${e.message})` };
  }
  const missing = required.filter((k) => result[k] === undefined);
  return missing.length ? { error: `the JSON answer is missing: ${missing.join(', ')}` } : { result };
}

// Tools of the user's Claude Code that publish, message or schedule outside this run. No agent run needs them, and a
// ticket or a question could try to make the agent use them, so they are always removed. MCP servers (including
// claude.ai connectors such as documents) are never loaded either (--strict-mcp-config without --mcp-config).
const OUTWARD = ['Artifact', 'ArtifactComments', 'ArtifactData', 'DesignSync', 'CronCreate', 'CronDelete', 'ScheduleWakeup', 'RemoteTrigger', 'SendMessage', 'PushNotification', 'EnterWorktree', 'ExitWorktree'];

/**
 * One `claude -p` process. Resolves with the final result event and the stream transcript.
 * @param {string[]} [p.tools]  an allow-list of built-in tools (e.g. ['Read','Grep','Glob']; [] = none). Without it the
 *   default set is used, minus `disallowedTools` and OUTWARD.
 */
function invokeClaude({ cwd, prompt, cfg, addDirs = [], disallowedTools = [], tools = null, permissionMode = null, timeoutMinutes, resume = null, onProgress = () => {} }) {
  const win = process.platform === 'win32';
  const denied = [...disallowedTools, ...OUTWARD];
  const args = [
    '-p',
    ...(resume ? ['--resume', resume] : []),
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(cfg.claude.maxTurns),
    '--strict-mcp-config',
    ...(tools ? ['--tools', tools.length ? tools.join(',') : win ? '""' : ''] : []),
    ...addDirs.flatMap((d) => ['--add-dir', d]),
    ...(permissionMode ? ['--permission-mode', permissionMode] : []),
    // Rules with spaces ("Bash(git push *)") must be quoted for cmd.exe on Windows.
    '--disallowedTools', ...denied.map((t) => (win && /\s/.test(t) ? `"${t}"` : t)),
    ...(cfg.claude.model ? ['--model', cfg.claude.model] : []),
  ];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(cfg.claude.command, args, { cwd, shell: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(prompt);
    const transcript = [];
    let buffer = '';
    let final = null;
    const limit = timeoutMinutes ?? cfg.analysisTimeoutMinutes;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`agent run timed out after ${limit} min`));
    }, limit * 60_000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        transcript.push(ev);
        if (ev.type === 'assistant') {
          for (const part of ev.message?.content ?? []) {
            if (part.type === 'tool_use') onProgress(describeTool(part.name, part.input));
          }
        }
        if (ev.type === 'result') final = ev;
      }
    });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (!final) return reject(new Error(`claude exited with ${code} without a result. ${stderr.slice(0, 300)}`));
      resolvePromise({ final, transcript });
    });
  });
}

/** Read-only analysis of one ticket (analyze-ticket skill). File-editing tools are disabled. */
export async function runAnalysis({ key, repoDir, stateDir, cfg, onProgress = () => {} }) {
  const workDir = join(stateDir, 'work', key);
  mkdirSync(workDir, { recursive: true });
  const out = await runClaude({
    cwd: repoDir,
    prompt: buildPrompt(key, workDir),
    cfg,
    transcriptFile: join(workDir, 'transcript.jsonl'),
    addDirs: [workDir],
    disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
    required: REQUIRED,
    onProgress,
  });
  writeFileSync(join(workDir, 'result.json'), JSON.stringify(out.result, null, 2));
  // Kept across demo resets (work folders are removed): the hotspot map and Ask use past analyses.
  mkdirSync(join(stateDir, 'results'), { recursive: true });
  writeFileSync(join(stateDir, 'results', `${key}.json`), JSON.stringify({ at: new Date().toISOString(), result: out.result, meta: out.meta }, null, 2));
  return out;
}
