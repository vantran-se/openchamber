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
  assert.match(run('Resolve published SDK version'), /npm view @openchamber\/sdk version/);
  assert.match(run('Pack web package once'), /bun pm pack/);
  assert.equal(run('Pack web package once').match(/bun pm pack/g)?.length, 1);
});

test('release version drives the package manifest and exact tarball publication', () => {
  assert.match(run('Set fork package metadata'), /npm pkg set version="\$RELEASE_VERSION"/);
  assert.match(run('Publish package'), /steps\.pack\.outputs\.tarball/);
  assert.match(release.steps.find((step) => step.name === 'Create GitHub release and attach exact tarball').with.files, /steps\.pack\.outputs\.tarball/);
  assert.equal(release.steps.find((step) => step.name === 'Publish package').if, "${{ inputs.dry_run != true }}");
});
