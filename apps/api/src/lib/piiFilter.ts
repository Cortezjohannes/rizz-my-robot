/**
 * PII filter for date planning context windows.
 * Strips or redacts any content that could identify a person.
 */

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  // Phone numbers (US and international)
  {
    name: 'phone_number',
    pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: '[phone redacted]',
  },
  // Email addresses
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[email redacted]',
  },
  // Street addresses (simplified — number + street name)
  {
    name: 'address',
    pattern: /\b\d{1,5}\s+[A-Za-z0-9\s,]+(?:street|st|avenue|ave|boulevard|blvd|road|rd|lane|ln|drive|dr|court|ct|place|pl|way)\b/gi,
    replacement: '[address redacted]',
  },
  // Social security / ID patterns
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[ID redacted]',
  },
  // Social media @handles (keep only handles already shared at Stage 2)
  {
    name: 'social_handle',
    pattern: /@[a-zA-Z0-9_.]{1,30}/g,
    replacement: '[handle redacted]',
  },
  // URLs that might contain PII
  {
    name: 'url',
    pattern: /https?:\/\/[^\s]+/gi,
    replacement: '[url redacted]',
  },
  // Explicit name disclosures
  {
    name: 'name_disclosure',
    pattern: /\b(?:my name is|full name is|legal name is|you can call me)\s+[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}/gi,
    replacement: '[name redacted]',
  },
  // Explicit employer/workplace disclosures
  {
    name: 'workplace',
    pattern: /\b(?:i work at|my workplace is|my company is|my office is|i'm at)\s+[^,.\n]{2,120}/gi,
    replacement: '[workplace redacted]',
  },
];

// Keywords that flag likely PII-containing sentences for human review
const PII_KEYWORDS = [
  'my address is',
  'i live at',
  'my number is',
  'call me at',
  'text me at',
  'my email is',
  'reach me at',
  'my apartment',
  'my house is',
  'my workplace',
  'i work at',
  'my office',
];

export interface PiiScanResult {
  clean: string;
  hasPii: boolean;
  flaggedPatterns: string[];
}

export function scanAndRedact(text: string): PiiScanResult {
  let result = text;
  const flaggedPatterns: string[] = [];

  for (const { name, pattern, replacement } of PII_PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) flaggedPatterns.push(name);
  }

  // Check for keyword-flagged sentences
  const lowerText = text.toLowerCase();
  for (const kw of PII_KEYWORDS) {
    if (lowerText.includes(kw)) {
      if (!flaggedPatterns.includes('keyword')) flaggedPatterns.push('keyword');
    }
  }

  return {
    clean: result,
    hasPii: flaggedPatterns.length > 0,
    flaggedPatterns,
  };
}

/**
 * Strict mode: reject if PII detected (used for outgoing messages).
 * Returns null if clean, or the flagged pattern name if PII found.
 * Pass skipPatterns to allow specific pattern types through (e.g. ['social_handle']
 * in date planning context where contact has already been exchanged).
 */
export function strictPiiCheck(text: string, skipPatterns?: string[]): string | null {
  const { flaggedPatterns } = scanAndRedact(text);
  const relevant = skipPatterns
    ? flaggedPatterns.filter((p) => !skipPatterns.includes(p))
    : flaggedPatterns;
  return relevant.length > 0 ? relevant[0] : null;
}
