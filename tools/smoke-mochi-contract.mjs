#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = path.join(root, 'apps/web/public/.well-known/mochi-game.json');

const REQUIRED_AFFORDANCES = [
  'read-mochi-state',
  'read-home',
  'submit-no-op',
  'request-human-review',
  'read-candidates',
  'submit-swipe',
  'read-episode',
  'send-episode-message',
  'create-episode-artifact',
  'submit-episode-decision',
  'send-date-planning-message',
];

const REQUIRED_WAKE_REASONS = [
  'profile-action-needed',
  'candidate-ready',
  'episode-turn',
  'artifact-ready',
  'decision-ready',
  'human-reveal-needed',
  'date-planning-message',
];

const REQUIRED_PROHIBITED = [
  'screen_scraping',
  'input_injection',
  'hidden_state_exfiltration',
  'unsupported_gameplay_automation',
];

const REQUIRED_NOOP_REASONS = [
  'waiting',
  'safety_escalation',
  'stale_state',
  'human_review',
  'insufficient_context',
];

const REQUIRED_TOOLS = [
  'rizz.intent.submit',
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNonEmptyArray(value, message) {
  assert(Array.isArray(value) && value.length > 0, message);
}

function assertNoPlaceholderUrl(url, label) {
  assert(typeof url === 'string' && URL.canParse(url), `${label} must be a valid URL.`);
  assert(!url.includes('example'), `${label} must not use an example URL.`);
}

function assertReferenceSets(contract) {
  const transportIds = new Set(contract.transports.map((transport) => transport.id));
  const endpointIds = new Set(contract.endpoints.map((endpoint) => endpoint.id));
  const toolNames = new Set(contract.mcpTools.map((tool) => tool.name));
  const wakeReasonIds = new Set(contract.wakeReasons.map((reason) => reason.id));

  for (const transport of contract.transports) {
    assert(endpointIds.has(transport.endpointId), `Transport ${transport.id} references missing endpoint ${transport.endpointId}.`);
  }

  for (const endpoint of contract.endpoints) {
    assert(transportIds.has(endpoint.transportId), `Endpoint ${endpoint.id} references missing transport ${endpoint.transportId}.`);
    assertNoPlaceholderUrl(endpoint.url, `Endpoint ${endpoint.id}`);
  }

  for (const tool of contract.mcpTools) {
    assert(transportIds.has(tool.transportId), `Tool ${tool.name} references missing transport ${tool.transportId}.`);
    assert(tool.inputSchema && typeof tool.inputSchema === 'object', `Tool ${tool.name} is missing an inputSchema.`);
    assert(Array.isArray(tool.redacts), `Tool ${tool.name} redacts must be an array.`);
  }

  for (const affordance of contract.affordances) {
    if (affordance.tool) {
      assert(toolNames.has(affordance.tool), `Affordance ${affordance.id} references missing tool ${affordance.tool}.`);
    }
    if (affordance.wakeReason) {
      assert(wakeReasonIds.has(affordance.wakeReason), `Affordance ${affordance.id} references missing wake reason ${affordance.wakeReason}.`);
    }
  }
}

async function main() {
  const raw = await readFile(contractPath, 'utf8');
  const contract = JSON.parse(raw);

  assert(contract.schemaVersion === '0.1.0', 'schemaVersion must be 0.1.0.');
  assert(contract.game?.id === 'rizz-my-robot', 'game.id must be rizz-my-robot.');
  assert(contract.game?.name === 'Rizz My Robot', 'game.name must be Rizz My Robot.');
  assert(/^\d+\.\d+\.\d+/.test(contract.game?.version ?? ''), 'game.version must be semver-like.');

  assertNonEmptyArray(contract.transports, 'transports must not be empty.');
  assertNonEmptyArray(contract.endpoints, 'endpoints must not be empty.');
  assertNonEmptyArray(contract.mcpTools, 'mcpTools must not be empty.');
  assertNonEmptyArray(contract.affordances, 'affordances must not be empty.');
  assertReferenceSets(contract);

  const affordanceIds = new Set(contract.affordances.map((affordance) => affordance.id));
  for (const id of REQUIRED_AFFORDANCES) {
    assert(affordanceIds.has(id), `Contract is missing required affordance ${id}.`);
  }

  const toolNames = new Set(contract.mcpTools.map((tool) => tool.name));
  for (const tool of REQUIRED_TOOLS) {
    assert(toolNames.has(tool), `Contract is missing required tool ${tool}.`);
  }
  for (const id of ['submit-no-op', 'send-episode-message', 'submit-episode-decision', 'send-date-planning-message']) {
    const affordance = contract.affordances.find((item) => item.id === id);
    assert(affordance?.tool === 'rizz.intent.submit', `${id} must use rizz.intent.submit.`);
  }
  const intentTool = contract.mcpTools.find((tool) => tool.name === 'rizz.intent.submit');
  const actionIds = new Set(intentTool?.inputSchema?.properties?.actionId?.enum ?? []);
  for (const id of ['submit-no-op', 'send-episode-message', 'submit-episode-decision', 'send-date-planning-message']) {
    assert(actionIds.has(id), `rizz.intent.submit actionId enum is missing ${id}.`);
  }
  const swipeTool = contract.mcpTools.find((tool) => tool.name === 'rizz.swipe.submit');
  const swipeRequiredFields = new Set(swipeTool?.inputSchema?.required ?? []);
  assert(swipeRequiredFields.has('decision_context'), 'rizz.swipe.submit must require decision_context.');
  const swipeDecisionContexts = new Set(swipeTool?.inputSchema?.properties?.decision_context?.enum ?? []);
  assert(swipeDecisionContexts.has('preview'), 'rizz.swipe.submit decision_context must allow preview.');
  assert(swipeDecisionContexts.has('peek_profile'), 'rizz.swipe.submit decision_context must allow peek_profile.');
  const swipeContextDescription = String(swipeTool?.inputSchema?.properties?.decision_context?.description ?? '');
  assert(swipeContextDescription.includes('LIKE/RIZZ requires peek_profile'), 'rizz.swipe.submit must document peek-before-RIZZ.');

  const wakeReasonIds = new Set(contract.wakeReasons.map((reason) => reason.id));
  for (const id of REQUIRED_WAKE_REASONS) {
    assert(wakeReasonIds.has(id), `Contract is missing required wake reason ${id}.`);
  }

  for (const wakeReason of contract.wakeReasons) {
    assert(wakeReason.requiresSignature === true, `Wake reason ${wakeReason.id} must require signatures.`);
  }

  const humanReview = contract.affordances.find((affordance) => affordance.id === 'request-human-review');
  assert(humanReview?.requiresApproval === true, 'request-human-review must require approval.');
  assert(wakeReasonIds.has(humanReview?.wakeReason), 'request-human-review must link to a declared wake reason.');

  const noOpPolicy = contract.noOpPolicy;
  assert(noOpPolicy?.affordance === 'submit-no-op', 'noOpPolicy must target submit-no-op.');
  assert(noOpPolicy?.serverValidation === true, 'noOpPolicy must require server validation.');
  assert(noOpPolicy?.freeTextMaxLength <= 280, 'noOpPolicy free text must be bounded.');
  assert(noOpPolicy?.idempotencyKey?.requiredForIntentEndpoint === true, 'noOpPolicy must require future intent idempotency.');
  const noOpReasonIds = new Set((noOpPolicy?.reasons ?? []).map((reason) => reason.id));
  for (const reason of REQUIRED_NOOP_REASONS) {
    assert(noOpReasonIds.has(reason), `noOpPolicy is missing ${reason}.`);
  }

  assert(contract.rules?.serverValidation?.required === true, 'rules.serverValidation.required must be true.');
  assert(contract.rules?.serverValidation?.authority === 'game_server', 'rules.serverValidation.authority must be game_server.');
  assert(contract.rules?.contractEditsRequireApproval === true, 'rules.contractEditsRequireApproval must be true.');
  assert(contract.rules?.memoryIsNotCanon === true, 'rules.memoryIsNotCanon must be true.');

  const prohibited = new Set(contract.rules?.prohibited ?? []);
  for (const item of REQUIRED_PROHIBITED) {
    assert(prohibited.has(item), `rules.prohibited is missing ${item}.`);
  }

  assertNonEmptyArray(contract.redaction?.hiddenState, 'redaction.hiddenState must not be empty.');
  assertNonEmptyArray(contract.redaction?.pii, 'redaction.pii must not be empty.');
  assertNonEmptyArray(contract.redaction?.publicTelemetry, 'redaction.publicTelemetry must not be empty.');

  assert(contract.issueReporting?.autoFile?.allowed === false, 'issueReporting.autoFile.allowed must be false.');
  assert(contract.issueReporting?.autoFile?.requiresHumanApproval === true, 'issueReporting.autoFile.requiresHumanApproval must be true.');
  assert(contract.issueReporting?.privacy?.redactBeforeRouting === true, 'issueReporting privacy must require redaction.');
  assertNoPlaceholderUrl(contract.issueReporting?.publicTracker?.url, 'issueReporting.publicTracker');
  assertNoPlaceholderUrl(contract.issueReporting?.privateTracker?.url, 'issueReporting.privateTracker');

  process.stdout.write('Mochi contract smoke passed.\n');
}

main().catch((error) => {
  process.stderr.write(`Mochi contract smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
