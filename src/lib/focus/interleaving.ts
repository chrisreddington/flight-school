export type InterleavingDay = 'consolidate' | 'stretch' | 'transfer';

export interface InterleavingHint {
  day: InterleavingDay;
  /** Token-efficient label for the AI prompt */
  label: string;
  /** Human-readable explanation for UI tooltip */
  uiReason: string;
}

export function getInterleavingContext(primaryLanguage: string, historyDays: number): InterleavingHint {
  const cycleDay = ((historyDays % 5) + 5) % 5;

  if (cycleDay === 0 || cycleDay === 3) {
    return {
      day: 'consolidate',
      label: `Reinforce: ${primaryLanguage}, same difficulty`,
      uiReason: `Consolidate day: repeat ${primaryLanguage} at a similar level to strengthen retention before adding more difficulty.`,
    };
  }

  if (cycleDay === 1 || cycleDay === 4) {
    return {
      day: 'stretch',
      label: `Stretch: ${primaryLanguage}, one level up`,
      uiReason: `Stretch day: stay in ${primaryLanguage} but move one level harder to create productive challenge.`,
    };
  }

  return {
    day: 'transfer',
    label: 'Transfer: different domain/language, same conceptual level',
    uiReason:
      'Transfer day: apply the same underlying concepts in a different domain or language to improve flexible recall.',
  };
}
