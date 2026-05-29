import { registerMonacoCancellationSuppressor } from '@/lib/dev/suppress-monaco-cancellation';

// Runs once on the client before the app hydrates. We register the Monaco
// cancellation suppressor here so its window listeners are in place as early
// as possible — ideally before Next's dev error overlay registers its own —
// which lets stopImmediatePropagation() keep the benign "Canceled" error out
// of the overlay. No-op in production (the suppressor self-gates).
registerMonacoCancellationSuppressor();
