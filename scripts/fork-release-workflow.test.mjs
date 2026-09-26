import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = yaml.parse(fs.readFileSync(`${root}/.github/workflows/release.yml`, 'utf8'));
const sdkPackage = JSON.parse(fs.readFileSync(`${root}/packages/sdk/package.json`, 'utf8'));

const metadataStep = workflow.jobs.release.steps.find((step) => step.name === 'Set fork package metadata');

test('fork release pins the published SDK version used by the workspace', () => {
  assert.ok(metadataStep, 'Set fork package metadata step is required');
  assert.equal(metadataStep.env.OPENCHAMBER_SDK_VERSION, sdkPackage.version);
});
