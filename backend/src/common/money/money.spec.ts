import { Money, MoneyError, toMoneyView } from './money';

describe('Money', () => {
  describe('parsing decimal strings', () => {
    it.each([
      ['12999.75', 1299975n],
      ['0.01', 1n],
      ['0.1', 10n],
      ['0', 0n],
      ['0.00', 0n],
      ['1', 100n],
      ['-250.50', -25050n],
      ['1000000000.99', 100000000099n],
    ])('parses %s to %s kobo', (input, expected) => {
      expect(Money.parse(input)).toBe(expected);
    });

    it('trims surrounding whitespace', () => {
      expect(Money.parse('  450.25  ')).toBe(45025n);
    });

    it.each([
      ['12,999.75', 'thousands separators'],
      ['₦12999.75', 'currency symbols'],
      ['12999.754', 'fractional kobo'],
      ['1e5', 'exponent notation'],
      ['abc', 'non-numeric input'],
      ['', 'an empty string'],
      ['  ', 'blank input'],
      ['12.', 'a trailing decimal point'],
      ['.5', 'a missing integer part'],
      ['--5', 'a double sign'],
    ])('rejects %s (%s)', (input) => {
      expect(() => Money.parse(input)).toThrow(MoneyError);
    });

    it('refuses numbers outright, because the precision is already lost', () => {
      expect(() => Money.parse(12999.75 as unknown as string)).toThrow(MoneyError);
    });

    it('accepts a bigint unchanged', () => {
      expect(Money.parse(1299975n)).toBe(1299975n);
    });

    it('reports validity without throwing', () => {
      expect(Money.isValid('12999.75')).toBe(true);
      expect(Money.isValid('12999.754')).toBe(false);
      expect(Money.isValid(12999.75)).toBe(false);
    });
  });

  describe('formatting', () => {
    it.each([
      [1299975n, '12999.75', '₦12,999.75'],
      [1n, '0.01', '₦0.01'],
      [0n, '0.00', '₦0.00'],
      [100n, '1.00', '₦1.00'],
      [-25050n, '-250.50', '-₦250.50'],
      [123456789012345n, '1234567890123.45', '₦1,234,567,890,123.45'],
    ])('formats %s kobo', (minor, decimal, formatted) => {
      expect(Money.toDecimalString(minor)).toBe(decimal);
      expect(Money.format(minor)).toBe(formatted);
    });

    it('round-trips every parsed value', () => {
      for (const value of ['0.01', '7.00', '999.99', '123456.78', '-0.05']) {
        expect(Money.toDecimalString(Money.parse(value))).toBe(
          value.includes('.') ? value : `${value}.00`,
        );
      }
    });

    it('labels other currencies with their code', () => {
      expect(Money.format(1050n, 'USD')).toBe('USD 10.50');
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts without drift', () => {
      expect(Money.add(Money.parse('0.1'), Money.parse('0.2'))).toBe(Money.parse('0.30'));
      expect(Money.subtract(Money.parse('100.00'), Money.parse('99.99'))).toBe(1n);
    });

    it('avoids the classic floating-point failures', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754.
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(Money.toDecimalString(Money.add(10n, 20n))).toBe('0.30');

      // Summing 0.01 a hundred times drifts in floating point, never here.
      const floatTotal = Array.from({ length: 100 }).reduce<number>((acc) => acc + 0.01, 0);
      expect(floatTotal).not.toBe(1);
      const exactTotal = Money.sum(Array.from({ length: 100 }, () => Money.parse('0.01')));
      expect(Money.toDecimalString(exactTotal)).toBe('1.00');
    });

    it('handles values far beyond Number.MAX_SAFE_INTEGER', () => {
      const huge = Money.parse('92233720368547.75');
      expect(huge).toBe(9223372036854775n);
      // Going through Number loses the exact value; staying in BigInt does not.
      expect(huge > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
      expect(BigInt(Number(huge))).not.toBe(huge);
      expect(Money.toDecimalString(Money.add(huge, 1n))).toBe('92233720368547.76');
    });

    it('sums an empty set to zero', () => {
      expect(Money.sum([])).toBe(0n);
      expect(Money.mean([])).toBe(0n);
    });

    it('signs amounts by direction', () => {
      expect(Money.signed(50000n, 'INFLOW')).toBe(50000n);
      expect(Money.signed(50000n, 'OUTFLOW')).toBe(-50000n);
      expect(Money.signed(-50000n, 'OUTFLOW')).toBe(-50000n);
    });
  });

  describe('allocation', () => {
    it('distributes a remainder without losing a kobo', () => {
      const parts = Money.allocate(Money.parse('100.00'), 3);
      expect(parts).toEqual([3334n, 3333n, 3333n]);
      expect(Money.sum(parts)).toBe(Money.parse('100.00'));
    });

    it('allocates negative amounts symmetrically', () => {
      const parts = Money.allocate(Money.parse('-0.05'), 2);
      expect(Money.sum(parts)).toBe(-5n);
    });

    it('rejects a nonsensical number of parts', () => {
      expect(() => Money.allocate(100n, 0)).toThrow(MoneyError);
      expect(() => Money.allocate(100n, 1.5)).toThrow(MoneyError);
    });
  });

  describe('API representation', () => {
    it('exposes every monetary value as strings only', () => {
      const view = toMoneyView(Money.parse('12999.75'));

      expect(view).toEqual({
        amount: '12999.75',
        amountMinor: '1299975',
        currency: 'NGN',
        formattedAmount: '₦12,999.75',
      });
      // Nothing in the payload is a number, so nothing can be read as a float.
      expect(Object.values(view).every((value) => typeof value === 'string')).toBe(true);
      expect(() => JSON.stringify(view)).not.toThrow();
    });
  });
});
