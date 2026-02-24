import { createLoggedLightweightCoachSession } from '@/lib/copilot/server';
import { extractJSON } from '@/lib/utils/json-utils';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  concept: string;
}

export interface QuizResult {
  questions: QuizQuestion[];
  topicTitle: string;
}

interface RawQuizResponse {
  questions?: Array<Partial<QuizQuestion>>;
}

function normalizeOption(option: string, index: number): string {
  const trimmed = option.trim();
  const label = ['A', 'B', 'C', 'D'][index] ?? 'A';
  if (/^[A-D]\.\s/.test(trimmed)) {
    return trimmed;
  }
  return `${label}. ${trimmed}`;
}

function buildFallbackQuestions(topicTitle: string, topicDescription: string): QuizQuestion[] {
  return [
    {
      id: 'q1',
      question: `What is the main idea behind "${topicTitle}"?`,
      options: [
        'A. It is only about memorizing facts',
        'B. It focuses on understanding the core purpose and tradeoffs',
        'C. It should always be avoided in production code',
        'D. It only applies to frontend projects',
      ],
      correctIndex: 1,
      explanation: `Here's what's happening: the goal is to understand the purpose, tradeoffs, and practical use of ${topicTitle}, not just memorize a definition.`,
      concept: `${topicTitle} fundamentals`,
    },
    {
      id: 'q2',
      question: `When applying "${topicTitle}", what should you do first?`,
      options: [
        'A. Identify the problem you are trying to solve',
        'B. Copy a random example without adapting it',
        'C. Skip testing and validation',
        'D. Assume one approach works in every case',
      ],
      correctIndex: 0,
      explanation: `Here's what's happening: starting with the problem context helps you choose the right approach and avoid misusing ${topicTitle}.`,
      concept: `${topicTitle} application`,
    },
    {
      id: 'q3',
      question: `How can you deepen your understanding of "${topicTitle}" over time?`,
      options: [
        'A. Avoid feedback and keep the same approach forever',
        'B. Focus only on theory and never practice',
        'C. Practice in small examples and reflect on outcomes',
        'D. Treat mistakes as proof you cannot learn it',
      ],
      correctIndex: 2,
      explanation: `Here's what's happening: deliberate practice and reflection build stronger mental models, especially when you connect ideas to real code decisions.${topicDescription ? ` In this topic, remember: ${topicDescription}` : ''}`,
      concept: `${topicTitle} reinforcement`,
    },
  ];
}

function normalizeQuestions(
  parsed: RawQuizResponse | null,
  topicTitle: string,
  topicDescription: string
): QuizQuestion[] {
  const fallback = buildFallbackQuestions(topicTitle, topicDescription);
  if (!parsed?.questions || parsed.questions.length === 0) {
    return fallback;
  }

  return [0, 1, 2].map((index) => {
    const source = parsed.questions?.[index];
    const fallbackQuestion = fallback[index];

    const rawOptions = source?.options?.filter((option): option is string => typeof option === 'string') ?? [];
    const normalizedOptions = rawOptions.slice(0, 4).map(normalizeOption);
    while (normalizedOptions.length < 4) {
      normalizedOptions.push(fallbackQuestion.options[normalizedOptions.length]);
    }

    const correctIndex =
      typeof source?.correctIndex === 'number' && source.correctIndex >= 0 && source.correctIndex <= 3
        ? source.correctIndex
        : fallbackQuestion.correctIndex;

    const explanation = typeof source?.explanation === 'string' && source.explanation.trim().length > 0
      ? source.explanation.trim()
      : fallbackQuestion.explanation;

    return {
      id: typeof source?.id === 'string' && source.id.trim().length > 0 ? source.id : fallbackQuestion.id,
      question:
        typeof source?.question === 'string' && source.question.trim().length > 0
          ? source.question.trim()
          : fallbackQuestion.question,
      options: normalizedOptions,
      correctIndex,
      explanation,
      concept:
        typeof source?.concept === 'string' && source.concept.trim().length > 0
          ? source.concept.trim()
          : fallbackQuestion.concept,
    };
  });
}

export async function generateTopicQuiz(
  topicTitle: string,
  topicDescription: string,
  profileContext: string
): Promise<QuizResult> {
  const prompt = `Topic: ${topicTitle}
Description: ${topicDescription}
Profile: ${profileContext}

Generate a 3-question practice quiz to reinforce understanding of this topic.

Growth mindset guidance:
- Explanations should be framed as "Here's what's happening: ..." not "You were wrong because..."
- Keep language supportive and focused on understanding.

Return JSON only:
{
  "questions": [
    {
      "id": "q1",
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "correctIndex": 0,
      "explanation": "Here's what's happening: ... [explain WHY this is correct, what to remember]",
      "concept": "..."
    }
  ]
}`;

  const loggedSession = await createLoggedLightweightCoachSession('Topic Practice Quiz', topicTitle);

  try {
    const result = await loggedSession.sendAndWait(prompt);
    const parsed = extractJSON<RawQuizResponse>(result.responseText, 'Topic Practice Quiz');
    const questions = normalizeQuestions(parsed, topicTitle, topicDescription);
    return {
      topicTitle,
      questions,
    };
  } finally {
    loggedSession.destroy();
  }
}

