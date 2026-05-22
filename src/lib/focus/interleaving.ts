type InterleavingDay = 'consolidate' | 'stretch' | 'transfer';

export interface InterleavingHint {
  day: InterleavingDay;
  /** Token-efficient label for the AI prompt */
  label: string;
  /** Human-readable explanation for UI tooltip */
  uiReason: string;
}
