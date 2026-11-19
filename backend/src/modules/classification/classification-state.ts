import { ClassificationSource, ClassificationStatus } from '../../common/domain/constants';

export class InvalidStateTransitionError extends Error {
  constructor(from: ClassificationStatus, to: ClassificationStatus, source: ClassificationSource) {
    super(`Cannot move classification from ${from} to ${to} via ${source}`);
    this.name = 'InvalidStateTransitionError';
  }
}

/**
 * The lifecycle, written down once. The rule that matters commercially: once a
 * human sets a category, no automated process may change it. A job queued before
 * the correction must not undo it when it finally runs - that is exactly what
 * destroys trust in an AI feature.
 */
const AUTOMATED_TARGETS: ClassificationStatus[] = [
  'CLASSIFIED',
  'PROVISIONAL',
  'FAILED_RETRYING',
  'PENDING',
];

const TRANSITIONS: Record<ClassificationStatus, ClassificationStatus[]> = {
  PENDING: [...AUTOMATED_TARGETS, 'MANUAL'],
  FAILED_RETRYING: [...AUTOMATED_TARGETS, 'MANUAL'],
  PROVISIONAL: [...AUTOMATED_TARGETS, 'MANUAL'],
  CLASSIFIED: [...AUTOMATED_TARGETS, 'MANUAL'],
  // Terminal for automation; only another human decision may follow.
  MANUAL: ['MANUAL'],
};

export function canTransition(
  from: ClassificationStatus,
  to: ClassificationStatus,
  source: ClassificationSource,
): boolean {
  if (source !== 'MANUAL' && from === 'MANUAL') return false;
  if (source !== 'MANUAL' && to === 'MANUAL') return false;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(
  from: ClassificationStatus,
  to: ClassificationStatus,
  source: ClassificationSource,
): void {
  if (!canTransition(from, to, source)) {
    throw new InvalidStateTransitionError(from, to, source);
  }
}

/** True when an automated classifier is allowed to touch this transaction. */
export function isAutomationAllowed(status: ClassificationStatus): boolean {
  return status !== 'MANUAL';
}

/**
 * Degraded answers stay FAILED_RETRYING while attempts remain and settle as
 * PROVISIONAL when they run out; confident answers are CLASSIFIED; anything
 * below the threshold is PROVISIONAL and stays reviewable.
 */
export function statusForAutomatedResult(input: {
  confidence: number;
  threshold: number;
  degraded?: boolean;
  attemptsRemaining: boolean;
}): ClassificationStatus {
  if (input.degraded) {
    return input.attemptsRemaining ? 'FAILED_RETRYING' : 'PROVISIONAL';
  }
  return input.confidence >= input.threshold ? 'CLASSIFIED' : 'PROVISIONAL';
}
