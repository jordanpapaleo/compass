/**
 * Intent detection — Day 1 rule-based classifier.
 *
 * Scores keyword/pattern signals over the conversation (weighted toward the
 * last user message) and returns the best-scoring intent. Deliberately simple
 * and fully unit-tested; the learning loop (Day 4) replaces/augments this with
 * observed user behavior, and an LLM classifier is a candidate upgrade — but
 * a router must not spend more time classifying than it saves routing.
 */

import type { ChatMessage, Intent } from "./types.ts";

interface Signal {
  intent: Intent;
  pattern: RegExp;
  weight: number;
}

// Order matters only for tie-breaking (first match wins ties).
const SIGNALS: Signal[] = [
  // PR / VCS specific — narrow phrases first, high weight
  { intent: "pr-description", pattern: /\b(pr|pull request) (description|title|body)\b/i, weight: 6 },
  { intent: "commit-message", pattern: /\bcommit message\b/i, weight: 6 },
  { intent: "pr-review", pattern: /\b(review|critique) (this|the|my)? ?(pr|pull request|diff|patch|changes?)\b/i, weight: 6 },
  { intent: "pr-review", pattern: /\bcode review\b/i, weight: 5 },

  // Debugging
  { intent: "debugging", pattern: /\b(debug|stack ?trace|exception|segfault|error message|why (is|does|am|isn'?t).*(fail|crash|break|not work))\b/i, weight: 4 },
  { intent: "debugging", pattern: /\b(fix|failing) (this|the|a) (bug|test|error|crash)\b/i, weight: 5 },
  { intent: "debugging", pattern: /\b(TypeError|ReferenceError|NullPointerException|panic:|Traceback)\b/, weight: 5 },

  // Architecture / planning
  { intent: "architecture", pattern: /\b(architect(ure)?|system design|design (a|the) (system|schema|api)|scal(e|ability)|trade-?offs?)\b/i, weight: 4 },
  { intent: "planning", pattern: /\b(plan|roadmap|milestones?|break (this|it) down|implementation plan|estimate)\b/i, weight: 3 },

  // Summarization / docs
  { intent: "summarization", pattern: /\b(summari[sz]e|tl;?dr|condense|key points|recap)\b/i, weight: 5 },
  { intent: "documentation", pattern: /\b(document(ation)?|docstrings?|jsdoc|readme|changelog|write.*docs)\b/i, weight: 4 },

  // Brainstorming / search
  { intent: "brainstorming", pattern: /\b(brainstorm|ideas? for|come up with|alternatives?|options for|what are some)\b/i, weight: 3 },
  { intent: "search", pattern: /\b(search|look up|find (documentation|info|examples of)|latest version)\b/i, weight: 3 },

  // Coding — broad, lower weight so specific intents win
  { intent: "coding", pattern: /\b(implement|refactor|write (a|the|some)? ?(function|class|component|script|test)|add (a|the) feature|typescript|python|rust\b|golang)\b/i, weight: 2 },
  { intent: "coding", pattern: /```/, weight: 2 },
];

export interface IntentResult {
  intent: Intent;
  /** Total score of the winning intent — 0 means nothing matched (chat). */
  score: number;
  /** Which signals fired, for explainability. */
  matched: string[];
}

export function detectIntent(messages: ChatMessage[]): IntentResult {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const system = messages.find((m) => m.role === "system");

  const scores = new Map<Intent, number>();
  const matched: string[] = [];

  const scan = (text: string, multiplier: number) => {
    for (const s of SIGNALS) {
      if (s.pattern.test(text)) {
        scores.set(s.intent, (scores.get(s.intent) ?? 0) + s.weight * multiplier);
        matched.push(`${s.intent}:${s.pattern.source.slice(0, 30)}`);
      }
    }
  };

  // Last user message is the strongest signal; system prompt is context.
  if (lastUser) scan(lastUser.content, 2);
  if (system) scan(system.content, 1);

  let best: Intent = "chat";
  let bestScore = 0;
  for (const [intent, score] of scores) {
    if (score > bestScore) {
      best = intent;
      bestScore = score;
    }
  }

  return { intent: best, score: bestScore, matched };
}

const ALL_INTENTS: Intent[] = [
  "pr-review", "pr-description", "commit-message", "coding", "debugging",
  "planning", "architecture", "summarization", "documentation",
  "brainstorming", "search", "chat",
];

export function isIntent(s: string): s is Intent {
  return (ALL_INTENTS as string[]).includes(s);
}
