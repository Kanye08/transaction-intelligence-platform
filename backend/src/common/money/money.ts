/**
 * Money.
 *
 * Nigerian Naira has two decimal places, so every amount is held as an integer
 * number of kobo in a BigInt: NGN 12,999.75 is 1299975n. No monetary value is
 * ever a JavaScript number, because 0.1 + 0.2 !== 0.3 and a financial ledger
 * cannot absorb that. Input arrives as a decimal *string* and is parsed
 * digit-by-digit, never through parseFloat, so the binary floating point
 * representation is not involved at any point.
 *
 * The database column is BIGINT; the API exposes the value three ways
 * (decimal string, minor-unit string, formatted string) and never as a number.
 */

export class MoneyError extends Error {}

const MINOR_UNITS_PER_MAJOR = 100n;
const DECIMAL_PLACES = 2;

/** Matches an optionally signed decimal with at most two fractional digits. */
const DECIMAL_PATTERN = /^-?\d{1,19}(\.\d{1,2})?$/;

export const Money = {
  /**
   * Parses a decimal string such as "12999.75" into kobo (1299975n).
   * Rejects floats, exponent notation, thousands separators, currency symbols
   * and fractional kobo, because silently rounding somebody's money is worse
   * than refusing the input.
   */
  parse(input: string | number | bigint): bigint {
    if (typeof input === 'bigint') return input;

    if (typeof input === 'number') {
      throw new MoneyError(
        'Monetary amounts must be provided as strings to avoid floating-point loss',
      );
    }

    const raw = input?.trim();
    if (!raw) throw new MoneyError('Amount is required');

    if (!DECIMAL_PATTERN.test(raw)) {
      throw new MoneyError(
        `Invalid monetary amount "${input}". Expected a decimal string with at most ` +
          `${DECIMAL_PLACES} decimal places, for example "12999.75"`,
      );
    }

    const negative = raw.startsWith('-');
    const unsigned = negative ? raw.slice(1) : raw;
    const [majorPart = '0', fractionPart = ''] = unsigned.split('.');

    const major = BigInt(majorPart);
    const minor = BigInt(fractionPart.padEnd(DECIMAL_PLACES, '0'));
    const total = major * MINOR_UNITS_PER_MAJOR + minor;

    return negative ? -total : total;
  },

  /** True when the input is a monetary string this module accepts. */
  isValid(input: unknown): boolean {
    if (typeof input !== 'string') return false;
    try {
      Money.parse(input);
      return true;
    } catch {
      return false;
    }
  },

  /** Formats kobo as a plain decimal string: 1299975n -> "12999.75". */
  toDecimalString(minorUnits: bigint): string {
    const negative = minorUnits < 0n;
    const absolute = negative ? -minorUnits : minorUnits;
    const major = absolute / MINOR_UNITS_PER_MAJOR;
    const minor = absolute % MINOR_UNITS_PER_MAJOR;
    return `${negative ? '-' : ''}${major}.${minor.toString().padStart(DECIMAL_PLACES, '0')}`;
  },

  /** Formats kobo for display: 1299975n -> "₦12,999.75". */
  format(minorUnits: bigint, currency = 'NGN'): string {
    const decimal = Money.toDecimalString(minorUnits);
    const negative = decimal.startsWith('-');
    const [major = '0', minor = '00'] = (negative ? decimal.slice(1) : decimal).split('.');
    const grouped = major.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const symbol = currency === 'NGN' ? '₦' : `${currency} `;
    return `${negative ? '-' : ''}${symbol}${grouped}.${minor}`;
  },

  add(a: bigint, b: bigint): bigint {
    return a + b;
  },

  subtract(a: bigint, b: bigint): bigint {
    return a - b;
  },

  sum(values: Iterable<bigint>): bigint {
    let total = 0n;
    for (const value of values) total += value;
    return total;
  },

  /** Multiplies by an integer factor (e.g. a quantity). Stays exact. */
  multiply(amount: bigint, factor: bigint): bigint {
    return amount * factor;
  },

  abs(value: bigint): bigint {
    return value < 0n ? -value : value;
  },

  /**
   * Divides into `parts`, distributing the remainder one kobo at a time so the
   * parts always add back up to the original amount - no kobo is created or
   * lost. Used for averages and allocations.
   */
  allocate(amount: bigint, parts: number): bigint[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new MoneyError('Allocation requires a positive integer number of parts');
    }
    const divisor = BigInt(parts);
    const base = amount / divisor;
    const remainder = amount - base * divisor;
    const step = remainder >= 0n ? 1n : -1n;
    let left = remainder >= 0n ? remainder : -remainder;

    return Array.from({ length: parts }, () => {
      if (left > 0n) {
        left -= 1n;
        return base + step;
      }
      return base;
    });
  },

  /**
   * Mean of a set of amounts, truncated towards zero. Returns 0n for an empty
   * set rather than NaN, so callers never have to special-case it.
   */
  mean(values: bigint[]): bigint {
    if (values.length === 0) return 0n;
    return Money.sum(values) / BigInt(values.length);
  },

  /** Signed value: inflows count positive, outflows negative. */
  signed(minorUnits: bigint, direction: 'INFLOW' | 'OUTFLOW'): bigint {
    const magnitude = Money.abs(minorUnits);
    return direction === 'INFLOW' ? magnitude : -magnitude;
  },
};

/** The shape every monetary value takes in an API response. */
export interface MoneyView {
  amount: string;
  amountMinor: string;
  currency: string;
  formattedAmount: string;
}

export function toMoneyView(minorUnits: bigint, currency = 'NGN'): MoneyView {
  return {
    amount: Money.toDecimalString(minorUnits),
    // Serialised as a string: JSON has no integer type wide enough, and
    // JSON.stringify cannot serialise BigInt at all.
    amountMinor: minorUnits.toString(),
    currency,
    formattedAmount: Money.format(minorUnits, currency),
  };
}
