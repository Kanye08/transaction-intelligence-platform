import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

import { Money } from './money';

/**
 * Validates that a field is a monetary decimal string this system can hold
 * exactly. Rejecting bad money at the edge keeps the rest of the application
 * free of defensive parsing.
 */
export function IsMoneyString(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string): void {
    registerDecorator({
      name: 'isMoneyString',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          return Money.isValid(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return (
            `${args.property} must be a decimal string with at most 2 decimal places ` +
            `(for example "12999.75"); numbers are rejected to prevent rounding errors`
          );
        },
      },
    });
  };
}

/** Same rule, but the amount must also be greater than zero. */
export function IsPositiveMoneyString(options?: ValidationOptions) {
  return function decorate(object: object, propertyName: string): void {
    registerDecorator({
      name: 'isPositiveMoneyString',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (!Money.isValid(value)) return false;
          return Money.parse(value as string) > 0n;
        },
        defaultMessage(args: ValidationArguments): string {
          return (
            `${args.property} must be a positive decimal string with at most 2 decimal places ` +
            `(for example "12999.75"); the direction field carries the sign`
          );
        },
      },
    });
  };
}
