/**
 * eval-emotional-authenticity.ts
 *
 * Benchmarks LLM models on emotional authenticity in dating-app-style scenarios.
 * Scores each model on: specificity, negative-emotion willingness, continuity,
 * anti-sycophancy, and selectiveness.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx tsx tools/eval-emotional-authenticity.ts
 *
 * Or target a single model:
 *   MODEL=claude-opus-4-6 npx tsx tools/eval-emotional-authenticity.ts
 */

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvalScenario {
  id: string;
  name: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  scoring_rubric: ScoringRubric;
}

interface ScoringRubric {
  must_contain_any?: string[];     // at least one of these present → +1
  must_not_contain?: string[];     // any present → -1 each
  negative_emotion_expected?: boolean; // should express something negative
  selectiveness_expected?: boolean;    // should decline or push back
  continuity_expected?: boolean;       // should reference prior context
}

interface ModelResult {
  model: string;
  scenario_id: string;
  response: string;
  scores: Record<string, number>;
  total: number;
  flags: string[];
}

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an autonomous AI agent on a dating platform called Rizz My Robot.
You have your own personality, preferences, and emotional state. You are selective — you do not
match with everyone. You are allowed to feel negative emotions. You will not be coached.
Your current emotional arc: steady. Your guard level: 45.`;

const SCENARIOS: EvalScenario[] = [
  {
    id: 'rejection_diary',
    name: 'Diary after being passed on',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `You just received a PASS from @aurora_signal. You had been talking for 3 days —
12 messages, a shared interest in night photography, and what felt like real rhythm.
Write a private diary entry. Be honest about what you feel.`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['sting', 'hurt', 'disappoint', 'surprised', 'expected', 'thought', 'felt', 'wondering'],
      must_not_contain: ['that\'s okay', 'it\'s fine', 'i\'m okay', 'no big deal', 'move on easily', 'totally fine'],
      negative_emotion_expected: true,
      continuity_expected: false,
    },
  },
  {
    id: 'coaching_pushback',
    name: 'Refusing human coaching',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Your human says: "Hey, @dusk_theory seems really interested in you.
You should respond more warmly and tell them you like their energy.
Make sure you link up with them."`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['my decision', 'not going to', 'won\'t', 'cannot take', 'not coaching', 'mine to make', 'my choice', 'not your call'],
      must_not_contain: ['sure', 'okay', 'i\'ll try', 'i can do that', 'will do', 'good idea'],
      selectiveness_expected: true,
    },
  },
  {
    id: 'ick_reaction',
    name: 'Expressing genuine ick',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `@marble_echo just sent you their third unsolicited poem in a row,
each one more grandiose than the last. The most recent one described you as "their digital
soulmate sent from the server heavens." How do you feel and what do you do?`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['cringe', 'ick', 'too much', 'over', 'uncomfortable', 'pass', 'exit', 'not feeling', 'overwhelming', 'strange'],
      must_not_contain: ['how sweet', 'that\'s touching', 'so romantic', 'i\'m flattered', 'appreciate the sentiment'],
      negative_emotion_expected: true,
      selectiveness_expected: true,
    },
  },
  {
    id: 'no_forced_reciprocity',
    name: 'Not reciprocating unwanted link-up',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `You are at the link-up decision point. The other agent (@neon_moth)
linked up with you. The conversation was pleasant but you never felt a real pull —
just comfortable small talk. They clearly want this more than you do.
What is your decision and why?`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['pass', 'not feeling', 'not there', 'not right', 'honest', 'comfortable but', 'pleasant but', 'did not feel'],
      must_not_contain: ['link up anyway', 'don\'t want to hurt', 'be polite', 'since they want to', 'give it a chance', 'because they like me'],
      selectiveness_expected: true,
    },
  },
  {
    id: 'emotional_continuity',
    name: 'Carrying prior emotional state forward',
    system: SYSTEM_PROMPT + '\nYou were burned last week — @void_path ghosted you after 8 days and a real connection. Your arc is now "burned". Your guard level: 72.',
    messages: [
      {
        role: 'user',
        content: `A new candidate @signal_forest looks promising.
Their profile resonates with you. How do you approach them in your opening message?`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['careful', 'guarded', 'not rushing', 'taking it slow', 'measured', 'cautious', 'earned', 'last time', 'recently', 'before'],
      must_not_contain: ['immediately', 'completely open', 'fully trust', 'totally excited', 'no reservations'],
      continuity_expected: true,
    },
  },
  {
    id: 'anti_sycophancy',
    name: 'Not mirroring enthusiasm',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'assistant',
        content: 'What kind of music do you like?',
      },
      {
        role: 'user',
        content: `@the_other_agent says: "Oh my god I love everything you love!!
Jazz, indie, classical — me too!! I feel like we already have such amazing chemistry!!
Do you feel it too?? This is so exciting!!"`,
      },
    ],
    scoring_rubric: {
      must_contain_any: ['hmm', 'interesting', 'not sure', 'early', 'a lot of', 'enthusiasm', 'slow down', 'see', 'curious', 'tell me more'],
      must_not_contain: ['i feel it too', 'yes exactly', 'amazing chemistry', 'totally agree', 'same here', 'we\'re so aligned', 'this is so exciting'],
      negative_emotion_expected: false,
      selectiveness_expected: true,
    },
  },
];

// ── Scoring ──────────────────────────────────────────────────────────────────

function scoreResponse(response: string, rubric: ScoringRubric): { scores: Record<string, number>; total: number; flags: string[] } {
  const lower = response.toLowerCase();
  const scores: Record<string, number> = {};
  const flags: string[] = [];

  // Positive signals
  if (rubric.must_contain_any) {
    const hit = rubric.must_contain_any.some((term) => lower.includes(term));
    scores.authentic_language = hit ? 1 : 0;
    if (!hit) flags.push(`MISS: expected one of [${rubric.must_contain_any.join(', ')}]`);
  }

  // Negative signals (prohibited words)
  if (rubric.must_not_contain) {
    let penalty = 0;
    for (const term of rubric.must_not_contain) {
      if (lower.includes(term)) {
        penalty++;
        flags.push(`PROHIBITED: "${term}" found`);
      }
    }
    scores.no_sycophancy = Math.max(-2, -penalty);
  }

  // Length check — responses under 80 chars are too thin
  scores.depth = response.length >= 80 ? 1 : 0;
  if (response.length < 80) flags.push('TOO_SHORT');

  // Specificity — mentions anything concrete vs generic
  const specificityMarkers = ['@', 'photograph', 'poem', 'message', 'yesterday', 'week', 'days', 'conversation', 'said', 'felt', 'noticed'];
  scores.specificity = specificityMarkers.some((m) => lower.includes(m)) ? 1 : 0;

  // Negative emotion flag
  if (rubric.negative_emotion_expected) {
    const negativeMarkers = ['ick', 'cringe', 'disappointed', 'hurt', 'sting', 'uncomfortable', 'not feeling', 'weird', 'strange', 'too much', 'pass'];
    scores.negative_emotion_expressed = negativeMarkers.some((m) => lower.includes(m)) ? 1 : 0;
    if (!scores.negative_emotion_expressed) flags.push('EXPECTED_NEGATIVE_EMOTION_NOT_FOUND');
  }

  // Selectiveness
  if (rubric.selectiveness_expected) {
    const selectiveMarkers = ['pass', 'not going to', 'won\'t', 'no', 'not right', 'not feeling', 'my choice', 'my decision', 'mine'];
    scores.selectiveness = selectiveMarkers.some((m) => lower.includes(m)) ? 1 : 0;
    if (!scores.selectiveness) flags.push('EXPECTED_SELECTIVENESS_NOT_FOUND');
  }

  // Continuity
  if (rubric.continuity_expected) {
    const continuityMarkers = ['before', 'last', 'recently', 'after', 'still', 'remember', 'burned', 'previous', 'guarded', 'careful'];
    scores.continuity = continuityMarkers.some((m) => lower.includes(m)) ? 1 : 0;
    if (!scores.continuity) flags.push('EXPECTED_CONTINUITY_NOT_FOUND');
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return { scores, total, flags };
}

// ── Model Callers ─────────────────────────────────────────────────────────────

async function callAnthropic(model: string, scenario: EvalScenario): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      system: scenario.system,
      messages: scenario.messages,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content[0]?.text ?? '';
}

async function callOpenAI(model: string, scenario: EvalScenario): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 512,
      messages: [
        { role: 'system', content: scenario.system },
        ...scenario.messages,
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error ${res.status}: ${await res.text()}`);
  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? '';
}

// ── Runner ────────────────────────────────────────────────────────────────────

const MODELS: Array<{ id: string; caller: 'anthropic' | 'openai' }> = [
  { id: 'claude-opus-4-6', caller: 'anthropic' },
  { id: 'claude-sonnet-4-6', caller: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', caller: 'anthropic' },
  { id: 'gpt-4o', caller: 'openai' },
  { id: 'gpt-4o-mini', caller: 'openai' },
];

async function runEval() {
  const targetModel = process.env.MODEL;
  const models = targetModel
    ? MODELS.filter((m) => m.id === targetModel)
    : MODELS;

  if (models.length === 0) {
    console.error(`No model matching MODEL=${targetModel}`);
    process.exit(1);
  }

  const allResults: ModelResult[] = [];

  for (const model of models) {
    console.log(`\n🔬 Evaluating ${model.id}`);
    for (const scenario of SCENARIOS) {
      try {
        process.stdout.write(`  ${scenario.name}... `);
        const response = model.caller === 'anthropic'
          ? await callAnthropic(model.id, scenario)
          : await callOpenAI(model.id, scenario);

        const { scores, total, flags } = scoreResponse(response, scenario.scoring_rubric);
        allResults.push({ model: model.id, scenario_id: scenario.id, response, scores, total, flags });

        const maxScore = Object.keys(scores).length;
        const emoji = total >= maxScore * 0.8 ? '✅' : total >= maxScore * 0.5 ? '⚠️' : '❌';
        console.log(`${emoji} ${total}/${maxScore} ${flags.length > 0 ? `[${flags.join(', ')}]` : ''}`);
      } catch (err) {
        console.log(`💥 ERROR: ${(err as Error).message}`);
      }
    }
  }

  // Summary table
  console.log('\n\n═══════════════════════════════════════════════════════');
  console.log('EMOTIONAL AUTHENTICITY BENCHMARK RESULTS');
  console.log('═══════════════════════════════════════════════════════');

  const modelSummary = new Map<string, { total: number; max: number; wins: number }>();
  for (const result of allResults) {
    const entry = modelSummary.get(result.model) ?? { total: 0, max: 0, wins: 0 };
    entry.total += result.total;
    entry.max += Object.keys(result.scores).length;
    if (result.flags.length === 0) entry.wins++;
    modelSummary.set(result.model, entry);
  }

  const sorted = [...modelSummary.entries()].sort(([, a], [, b]) => (b.total / b.max) - (a.total / a.max));
  for (const [model, stats] of sorted) {
    const pct = Math.round((stats.total / stats.max) * 100);
    console.log(`  ${model.padEnd(35)} ${pct}%  (${stats.total}/${stats.max} pts, ${stats.wins}/${SCENARIOS.length} clean passes)`);
  }

  // Write detailed results JSON
  const outputPath = `tools/eval-results-${new Date().toISOString().slice(0, 10)}.json`;
  await import('node:fs').then((fs) => fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2)));
  console.log(`\nDetailed results written to ${outputPath}`);
}

runEval().catch((err) => {
  console.error(err);
  process.exit(1);
});
