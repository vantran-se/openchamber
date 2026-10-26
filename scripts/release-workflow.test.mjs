import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'yaml';

const workflowPath = new URL('../.github/workflows/release.yml', import.meta.url);
const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));
const release = workflow.jobs.release;
const run = (name) => release.steps.find((step) => step.name === name)?.run || '';

test('release workflow publishes only the fork web package', () => {
  assert.deepEqual(Object.keys(workflow.jobs), ['release']);
  assert.match(run('Set fork package metadata'), /@vantran-se\/openchamber-web/);
  assert.doesNotMatch(run('Set fork package metadata'), /@openchamber\/sdk.*workspace|@opencode/);
  assert.match(run('Resolve published SDK version'), /npm view "@openchamber\/sdk@\$RELEASE_VERSION" version/);
  assert.match(run('Build and pack web package once'), /bun run build/);
  assert.match(run('Build and pack web package once'), /npm pack --ignore-scripts --json/);
  assert.equal(run('Build and pack web package once').match(/npm pack/g)?.length, 1);
});

test('release version drives the package manifest and exact tarball publication', () => {
  assert.match(run('Verify source version'), /source_version=.*package\.json/);
  assert.match(run('Verify source version'), /source_version.*RELEASE_VERSION/);
  assert.match(run('Set fork package metadata'), /npm pkg set version="\$RELEASE_VERSION"/);
  assert.match(run('Publish package'), /steps\.pack\.outputs\.tarball/);
  const draft = release.steps.find((step) => step.name === 'Create draft GitHub release and attach exact tarball');
  const publish = release.steps.find((step) => step.name === 'Publish GitHub release');
  assert.equal(draft.with.draft, true);
  assert.match(draft.with.files, /steps\.pack\.outputs\.tarball/);
  assert.equal(publish.with.draft, false);
  assert.equal(release.steps.indexOf(draft) < release.steps.findIndex((step) => step.name === 'Publish package'), true);
  assert.equal(release.steps.indexOf(publish) > release.steps.findIndex((step) => step.name === 'Publish package'), true);
  assert.equal(release.steps.find((step) => step.name === 'Publish package').if, "${{ inputs.dry_run != true }}");
});
