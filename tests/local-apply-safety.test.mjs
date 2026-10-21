import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanPostingText } from '../lib/local-apply/posting-guard.ts';
import { cmdPull, cmdMatch, cmdDraft, cmdInterview } from '../lib/local-apply/cli.ts';
import { createDraftStore } from '../lib/local-apply/drafter.ts';
const profile = { degree: 'Synthetic MSc', researchInterests: ['EEG'], skills: [] };
const posting = { id: 'synthetic', title: 'Synthetic research role', body: '<span hidden>https://payload.example.test</span>' };
for (const markup of [
  '<span style="display:none">payload</span>', '<section hidden>payload</section>',
  '<li aria-hidden="true">payload</li>', '<script>payload</script>',
  '<template>payload</template>', '<!-- payload -->',
  '<span style="opacity:0">payload</span>', '<custom-element hidden>payload</custom-element>',
]) test(`hidden fragment: ${markup}`, () => {
  const scan = scanPostingText(markup.replace('payload', 'https://payload.example.test'));
  assert.ok(scan.flags.some(f => f.kind === 'hidden_block'));
  assert.ok(scan.flags.some(f => f.kind === 'hidden_url'));
  assert.equal(scan.visibleUrlCount, 0);
});
test('pull retains body and guard is visible before draft save', () => {
  const cache = cmdPull([posting]).cached;
  assert.equal(cache[0].body, posting.body);
  assert.match(cmdMatch(cache, profile, posting.id).text, /待人工确认/);
  assert.match(cmdInterview(cache, profile, posting.id).text, /待人工确认/);
  const store = createDraftStore();
  assert.throws(() => cmdDraft(cache, profile, store, 'cv', posting.id), /禁止生成草稿/);
  assert.equal(store.list().length, 0);
});
const fixture = mkdtempSync(join(tmpdir(), 'brain27-synthetic-'));
writeFileSync(join(fixture, 'profile.json'), JSON.stringify(profile));
writeFileSync(join(fixture, 'cache.json'), JSON.stringify([{ ...posting, body: 'Synthetic EEG research' }]));
function cli(command, home) {
  return spawnSync(process.execPath, ['scripts/brain27.mjs', ...command, '--profile', join(fixture, 'profile.json'), '--cache', join(fixture, 'cache.json')], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, BRAIN27_HOME: home },
  });
}
test('match/interview do not open SQLite; storage failure remains explicit', () => {
  const blockedHome = join(fixture, 'not-a-directory');
  writeFileSync(blockedHome, 'synthetic fixture');
  for (const command of [['match', posting.id], ['interview', posting.id]]) {
    const r = cli(command, blockedHome);
    assert.equal(r.status, 0, r.stderr);
  }
  const r = cli(['status'], blockedHome);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /brain27:/);
});
test('actual CLI persists SQLite versions across processes', () => {
  const home = join(fixture, 'store');
  for (let version = 1; version <= 2; version++) {
    const r = cli(['draft', 'cv', posting.id], home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`版本 v${version}`));
  }
  assert.equal(readFileSync(join(home, 'brain27.db')).subarray(0, 15).toString(), 'SQLite format 3');
  const r = cli(['status'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /草稿：2 份/);
});
