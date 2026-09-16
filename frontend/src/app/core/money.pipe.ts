import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a price in the tenant's currency, in the phone's own locale — a Tunisian menu shows
 * three decimals for TND without anyone configuring it.
 */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  private static readonly formatters = new Map<string, Intl.NumberFormat>();

  transform(value: number | null | undefined, currency: string | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '';

    const code = (currency || 'USD').toUpperCase();

    let formatter = MoneyPipe.formatters.get(code);

    if (!formatter) {
      try {
        formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: code });
      } catch {
        // An unknown code is not worth breaking a menu over.
        return `${value.toFixed(2)} ${code}`;
      }

      MoneyPipe.formatters.set(code, formatter);
    }

    return formatter.format(value);
  }
}
