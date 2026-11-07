import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadProjects } from '../lib/projects.mjs';
import { fixBlocker } from '../lib/pipeline.mjs';
import { peersSection } from '../lib/analyze.mjs';

const write = (cfg) => {
  const dir = mkdtempSync(join(tmpdir(), 'ti-projects-'));
  writeFileSync(join(dir, 'agent.config.json'), JSON.stringify(cfg));
  return dir;
};

test('an old single-project config is read as one project with the state in state/', () => {
  const dir = write({ project: 'DEM', repo: '../app', labels: { done: 'ai-analyzed' }, insights: { months: 10, components: [{ name: 'A', paths: ['a/'] }] } });
  const all = loadProjects(dir);
  assert.equal(all.projects.length, 1);
  const p = all.projects[0];
  assert.equal(p.key, 'DEM');
  assert.equal(p.stateDir, join(dir, 'state'));
  assert.equal(p.cfg.project, 'DEM');
  assert.equal(p.cfg.labels.done, 'ai-analyzed');
  assert.deepEqual(p.cfg.insights.components.map((c) => c.name), ['A']);
  assert.equal(p.app.url, 'http://localhost:4200');
});

test('projects override the shared settings, get their own state folder, and are found by ticket key', () => {
  const dir = write({
    pollSeconds: 30, insights: { months: 10, churnDays: 90 }, backendTestDir: 'backend/src/test/java/x',
    projects: [
      { key: 'DEM', name: 'MediAgenda', repo: '../a', stateDir: 'state', insights: { components: [{ name: 'Agenda', paths: ['f/'] }] } },
      { key: 'lab', name: 'MediLab', repo: '../b', app: { frontend: 4201, backend: 8081 }, linked: ['DEM'], backendTestDir: 'backend/src/test/java/lab' },
    ],
  });
  const all = loadProjects(dir);
  const lab = all.ofTicket('LAB-12');
  assert.equal(lab.name, 'MediLab');
  assert.equal(lab.stateDir, join(dir, 'state', 'projects', 'LAB'));
  assert.deepEqual(lab.linked, ['DEM']);
  assert.equal(lab.cfg.backendTestDir, 'backend/src/test/java/lab');
  assert.equal(lab.cfg.insights.churnDays, 90);
  assert.equal(lab.app.url, 'http://localhost:4201');
  assert.equal(all.byKey('dem').cfg.backendTestDir, 'backend/src/test/java/x');
  assert.equal(all.byKey('dem').cfg.insights.months, 10);
  assert.equal(all.ofTicket('XYZ-1'), null);
  assert.equal(lab.cfg.projects, undefined);
});

test('a link to an unknown project is a configuration error', () => {
  const dir = write({ projects: [{ key: 'LAB', repo: '../b', linked: ['NOPE'] }] });
  assert.throws(() => loadProjects(dir), /links unknown project/);
});

const POLICY = { actions: { proposeFix: 'auto' }, proposeFixWhen: { minConfidence: 'high', titleTags: ['FE', 'BE'], inferTagFromFiles: { FE: 'frontend/', BE: 'backend/' } } };

test('no automatic fix when the analysis puts the fix in a linked project', () => {
  const issue = { key: 'BIL-9', summary: '[BE] Fatture: cancelled visits are invoiced' };
  assert.equal(fixBlocker({ issue, result: { confidence: 'high', fixInProject: 'DEM' }, policy: POLICY }), 'the fix belongs in project DEM, not in BIL');
  assert.equal(fixBlocker({ issue, result: { confidence: 'high', fixInProject: 'bil', otherProjects: [{ key: 'DEM' }] }, policy: POLICY }), null);
  assert.equal(fixBlocker({ issue, result: { confidence: 'high' }, policy: POLICY }), null);
});

test('files of a linked project do not decide the side of an untagged ticket', () => {
  const issue = { key: 'FAR-4', summary: 'Dose warning missing for metformin' };
  const result = { confidence: 'high', files: ['backend/src/main/java/com/medifarma/x.java', 'LAB:backend/src/main/java/com/medilab/y.java'] };
  assert.equal(fixBlocker({ issue, result, policy: POLICY }), null);
});

test('the analysis prompt names the linked projects and where their code is', () => {
  const s = peersSection({ key: 'BIL', name: 'MediBill' }, [{ key: 'DEM', name: 'MediAgenda', dir: 'C:/x/peer-repo', relation: 'bookings to invoice' }]);
  assert.match(s, /MediAgenda \(Jira project DEM\): code on its main, read-only, at "C:\/x\/peer-repo" · bookings to invoice/);
  assert.equal(peersSection({ key: 'DEM', name: 'MediAgenda' }, []), '');
});
