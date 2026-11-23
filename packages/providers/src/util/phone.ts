/** Phone normalization to E.164. Pragmatic; handles BR specifics. */

const COUNTRY_DIAL: Record<string, string> = {
  BR: '55',
  US: '1',
  PT: '351',
  AR: '54',
};

export interface NormalizedPhone {
  /** digits only, with country code, no '+' (used by providers) */
  digits: string;
  /** E.164 with leading '+' (used by Chatwoot phone_number) */
  e164: string;
}

export interface NormalizeOptions {
  /**
   * The number is already international (has its country code). True for every
   * number that comes FROM WhatsApp — a JID, a provider's `phone`/`sender_pn` —
   * because WhatsApp addresses people by full international number. Then no
   * country code is ever prepended.
   *
   * Defaults to true when the raw value is a JID (`…@s.whatsapp.net`) or starts
   * with `+`; otherwise the number may be a locally-typed one.
   */
  international?: boolean;
}

/**
 * A BARE number that looks like a local number of `country` (no country code).
 * Only Brazil has a real rule here: DDD 11–99 + 8 digits (landline) or + 9
 * digits starting with 9 (mobile). Anything else is assumed international.
 *
 * The old rule ("doesn't start with 55 and has ≤ 11 digits") turned every
 * US/Canada number (`1` + 10 digits = 11) into `55…`: messages arrived, but
 * replies went to a number that doesn't exist.
 */
function looksLocal(digits: string, country: string): boolean {
  if (country !== 'BR') return digits.length <= 10 && digits.length >= 8;
  if (!/^[1-9][1-9]/.test(digits)) return false;
  if (digits.length === 10) return /^[1-9][1-9][2-9]/.test(digits);
  if (digits.length === 11) return /^[1-9][1-9]9/.test(digits);
  return false;
}

/**
 * Normalize a raw WhatsApp number/jid into digits + E.164.
 * Strips suffixes like @s.whatsapp.net / @c.us / @lid before processing.
 */
export function normalizePhone(
  raw: string,
  defaultCountry = 'BR',
  opts: NormalizeOptions = {},
): NormalizedPhone {
  const trimmed = raw.trim();
  const international = opts.international ?? (trimmed.includes('@') || trimmed.startsWith('+'));
  const cleaned = trimmed.split('@')[0] ?? trimmed;
  let digits = cleaned.replace(/\D/g, '').replace(/^0+/, '');
  const country = defaultCountry.toUpperCase();
  const dial = COUNTRY_DIAL[country] ?? '55';

  // Only a number typed locally (no country code) gets the default one.
  if (!international && !digits.startsWith(dial) && looksLocal(digits, country)) {
    digits = dial + digits;
  }

  return { digits, e164: `+${digits}` };
}

/**
 * The international number hiding behind a WRONG Brazilian prefix — what the old
 * normalization produced for a US/Canada number (`55` + `1` + 10 digits). A real
 * Brazilian 13-digit number is a mobile: its 5th digit (first after the DDD) is
 * 9. Returns null when `digits` is not such a mistake.
 */
export function wrongBrazilianPrefix(digits: string | null | undefined): string | null {
  if (!digits || !/^55\d{11}$/.test(digits)) return null;
  return digits[4] === '9' ? null : digits.slice(2);
}

const E164 = /^\+[1-9]\d{1,14}$/;
export function isE164(value: string): boolean {
  return E164.test(value);
}
