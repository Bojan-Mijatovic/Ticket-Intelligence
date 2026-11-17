import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerHtml, mentionOf, messageText, newQuestions, noteHtml, projectOf, questionOf } from '../lib/teams-inbox.mjs';

const ME = { id: 'agent-1', name: 'Ticket Intelligence' };
const person = (id = 'u-1', name = 'Marta Ricci') => ({ user: { id, displayName: name } });
const msg = (id, html, extra = {}) => ({ id, messageType: 'message', createdDateTime: '2026-11-17T12:00:00Z', from: person(), body: { contentType: 'html', content: html }, ...extra });

test('a message\'s text: HTML out, entities decoded, the agent\'s @mention taken out and others kept', () => {
  const m = msg('1', '<p><at id="0">Ticket Intelligence</at> who knows <b>Scadenze</b> &amp; the due list?<br>thanks <at id="1">Irene Fabbri</at></p>', {
    mentions: [{ id: 0, mentioned: { user: { id: 'agent-1' } } }, { id: 1, mentioned: { user: { id: 'u-2' } } }],
  });
  assert.deepEqual(messageText(m, { me: ME }), { text: 'who knows Scadenze & the due list?\nthanks Irene Fabbri', mentionsMe: true });
  assert.equal(messageText(msg('2', '<p>plain</p>'), { me: ME }).mentionsMe, false);
});

test('a question for the agent: "ti:" or an @mention of it, from a person; never its own, a card, a deleted or a system message', () => {
  assert.equal(questionOf(msg('1', '<p>ti: status VAX-21</p>'), { me: ME }), 'status VAX-21');
  assert.equal(questionOf(msg('1', '<p>TI : http://localhost:4204/scadenze</p>'), { me: ME }), 'http://localhost:4204/scadenze');
  assert.equal(questionOf(msg('1', '<p><at id="0">Ticket Intelligence</at> who knows Scadenze?</p>', { mentions: [{ id: 0, mentioned: { user: { id: 'agent-1' } } }] }), { me: ME }), 'who knows Scadenze?');
  assert.equal(questionOf(msg('1', '<p>is VAX-21 done? ti</p>'), { me: ME }), null, 'people talking');
  assert.equal(questionOf(msg('1', '<p>ti: x</p>', { from: person('agent-1', 'Ticket Intelligence') }), { me: ME }), null, 'never its own reply');
  assert.equal(questionOf(msg('1', '<p>ti: status</p>', { from: { application: { displayName: 'Workflows' } } }), { me: ME }), null, 'the webhook\'s cards are not people');
  assert.equal(questionOf(msg('1', '<p>ti: status</p>', { deletedDateTime: '2026-11-17T12:01:00Z' }), { me: ME }), null);
  assert.equal(questionOf(msg('1', '<p>ti: status</p>', { messageType: 'systemEventMessage' }), { me: ME }), null);
  assert.equal(questionOf(msg('1', `<p>ti: ${'x'.repeat(900)}</p>`), { me: ME }).length, 500);
});

test('the project: named before a colon (key or name), else the thread\'s or the channel\'s', () => {
  const projects = [{ key: 'VAX', name: 'MediVax' }, { key: 'LAB', name: 'MediLab' }];
  assert.deepEqual(projectOf('MediLab: who knows the order code?', projects, 'VAX'), { project: 'LAB', question: 'who knows the order code?', named: true });
  assert.deepEqual(projectOf('lab: latest tickets', projects, 'VAX'), { project: 'LAB', question: 'latest tickets', named: true });
  assert.equal(projectOf('VAX-21: what happened?', projects, 'VAX').named, false, 'a ticket key is not a project');
  assert.equal(projectOf('http://localhost:4201/richieste', projects, 'VAX').project, 'VAX', 'an address picks its project in Ask, by its port');
  assert.equal(projectOf('status: VAX-21', projects, 'VAX').question, 'status: VAX-21');
});

test('the new questions of a read: posts and replies, oldest first, never handled ones or the past', () => {
  const at = (m) => `2026-11-17T12:${String(m).padStart(2, '0')}:00Z`;
  const roots = [
    { ...msg('r2', '<p>ti: who knows Scadenze?</p>', { createdDateTime: at(5) }), replies: [msg('r2a', '<p>ti: and where is it?</p>', { createdDateTime: at(7), from: person('u-2', 'Luca Bianchi') }), msg('r2b', '<p>ok thanks</p>', { createdDateTime: at(8) })] },
    { ...msg('r1', '<p>ti: VAX-21</p>', { createdDateTime: at(2) }), replies: [] },
    { ...msg('old', '<p>ti: before the inbox started</p>', { createdDateTime: at(0) }), replies: [] },
  ];
  const qs = newQuestions(roots, { me: ME, since: at(1), handled: ['r1'] });
  assert.deepEqual(qs.map((q) => [q.id, q.rootId, q.inThread, q.question, q.from.name]), [
    ['r2', 'r2', false, 'who knows Scadenze?', 'Marta Ricci'],
    ['r2a', 'r2', true, 'and where is it?', 'Luca Bianchi'],
  ]);
});

test('the answer in the thread: the asker @mentioned, the text escaped, sources as links, how it was made', () => {
  const html = answerHtml({ answer: 'Scadenze has had 3 bugs <script>.\nNewest first: VAX-21.', sources: [{ ref: 'VAX-21', url: 'https://jira.example/browse/VAX-21?a=1&b=2' }, { ref: 'frontend/src/x.ts', url: null }] }, { asker: { id: 'u-1', name: 'Marta Ricci' }, projectName: 'MediVax', how: 'by plain code from the Insights data (no AI)', followUp: true });
  assert.match(html, /^<at id="0">Marta Ricci<\/at> Scadenze has had 3 bugs &lt;script&gt;\.<br>Newest first: VAX-21\./);
  assert.match(html, /<b>Sources:<\/b> <a href="https:\/\/jira\.example\/browse\/VAX-21\?a=1&amp;b=2">VAX-21<\/a> · frontend\/src\/x\.ts/);
  assert.match(html, /<i>MediVax · answered by plain code from the Insights data \(no AI\), following the answer above · reply with "ti: …" to ask more<\/i>$/);
  assert.deepEqual(mentionOf({ id: 'u-1', name: 'Marta Ricci' }), [{ id: 0, mentionText: 'Marta Ricci', mentioned: { user: { id: 'u-1', displayName: 'Marta Ricci', userIdentityType: 'aadUser' } } }]);
  assert.deepEqual(mentionOf(null), []);
  assert.match(answerHtml({ answer: 'x', found: false }, { projectName: 'MediVax', how: 'by Claude', givenAgain: true }), /^x<br><i>MediVax · not found by Claude, given again/);
  assert.equal(noteHtml('Busy <now>'), '<i>Busy &lt;now&gt;</i>');
});
