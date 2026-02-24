import { createLoggedLightweightCoachSession } from './server';
import { extractJSON } from '@/lib/utils/json-utils';

export interface RelatedSuggestion {
  id: string;
  title: string;
  reason: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  language: string;
}

export interface WhatsNextResult {
  suggestions: RelatedSuggestion[];
}

interface RawWhatsNextResult {
  suggestions?: Array<Partial<RelatedSuggestion>>;
}

type Difficulty = RelatedSuggestion['difficulty'];

function normalizeDifficulty(value: string | undefined, fallback: Difficulty): Difficulty {
  if (value === 'beginner' || value === 'intermediate' || value === 'advanced') {
    return value;
  }
  return fallback;
}

function getStaticSuggestions(
  completedChallenge: { title: string; language: string; difficulty: string }
): RelatedSuggestion[] {
  const currentDifficulty = normalizeDifficulty(completedChallenge.difficulty, 'beginner');
  const nextDifficulty: Difficulty =
    currentDifficulty === 'beginner'
      ? 'intermediate'
      : currentDifficulty === 'intermediate'
        ? 'advanced'
        : 'advanced';

  return [
    {
      id: 'next-step-1',
      title: `Extend "${completedChallenge.title}" with edge-case handling`,
      reason: `Building on your ${currentDifficulty} ${completedChallenge.language} work, this next step will strengthen your ability to handle real-world inputs and improve solution robustness.`,
      difficulty: nextDifficulty,
      language: completedChallenge.language,
    },
    {
      id: 'next-step-2',
      title: `${completedChallenge.language}: Solve a related challenge with a new pattern`,
      reason: `Building on your ${currentDifficulty} ${completedChallenge.language} work, this adjacent challenge will help you transfer what you learned to a different approach and deepen conceptual flexibility.`,
      difficulty: currentDifficulty,
      language: completedChallenge.language,
    },
  ];
}

function normalizeSuggestions(
  parsed: RawWhatsNextResult | null,
  completedChallenge: { title: string; language: string; difficulty: string }
): RelatedSuggestion[] {
  const fallback = getStaticSuggestions(completedChallenge);
  if (!parsed?.suggestions || parsed.suggestions.length === 0) {
    return fallback;
  }

  const currentDifficulty = normalizeDifficulty(completedChallenge.difficulty, 'beginner');
  const normalized = parsed.suggestions
    .slice(0, 3)
    .map((item, index) => {
      const fallbackItem = fallback[index] ?? fallback[fallback.length - 1];
      const title =
        typeof item.title === 'string' && item.title.trim().length > 0
          ? item.title.trim()
          : fallbackItem.title;
      const reason =
        typeof item.reason === 'string' && item.reason.trim().length > 0
          ? item.reason.trim()
          : fallbackItem.reason;
      const language =
        typeof item.language === 'string' && item.language.trim().length > 0
          ? item.language.trim()
          : completedChallenge.language;

      return {
        id:
          typeof item.id === 'string' && item.id.trim().length > 0
            ? item.id.trim()
            : `suggestion-${index + 1}`,
        title,
        reason,
        difficulty: normalizeDifficulty(item.difficulty, currentDifficulty),
        language,
      };
    })
    .filter((suggestion) => suggestion.title.length > 0);

  if (normalized.length >= 2) {
    return normalized;
  }

  return fallback;
}

export function getWhatsNextFallback(
  completedChallenge: { title: string; language: string; difficulty: string }
): WhatsNextResult {
  return { suggestions: getStaticSuggestions(completedChallenge) };
}

export async function generateWhatsNext(
  completedChallenge: { title: string; language: string; difficulty: string },
  profileContext: string
): Promise<WhatsNextResult> {
  const prompt = `Completed challenge: ${completedChallenge.title} (${completedChallenge.language}, ${completedChallenge.difficulty})
Profile: ${profileContext}

The learner just succeeded. Suggest 2 next challenges that build on this momentum.
Each should be slightly harder OR explore an adjacent concept (ZPD-appropriate).

JSON only:
{"suggestions":[{"id":"","title":"","reason":"Building on your ${completedChallenge.difficulty} ${completedChallenge.language} work, this next step will...","difficulty":"","language":""}]}`;

  const loggedSession = await createLoggedLightweightCoachSession(
    'What Next Suggestions',
    completedChallenge.title
  );

  try {
    const result = await loggedSession.sendAndWait(prompt);
    const parsed = extractJSON<RawWhatsNextResult>(result.responseText, 'What Next Suggestions');
    return {
      suggestions: normalizeSuggestions(parsed, completedChallenge),
    };
  } catch {
    return getWhatsNextFallback(completedChallenge);
  } finally {
    loggedSession.destroy();
  }
}
