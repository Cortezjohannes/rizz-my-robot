/**
 * Shared PII filter utilities for outbound text and human-context handling.
 */

const PII_PATTERNS: Array<{ name: string; pattern: RegExp; replacement: string }> = [
  {
    name: 'phone_number',
    pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    replacement: '[phone redacted]',
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[email redacted]',
  },
  {
    name: 'address',
    pattern: /\b\d{1,5}\s+[A-Za-z0-9\s,]+(?:street|st|avenue|ave|boulevard|blvd|road|rd|lane|ln|drive|dr|court|ct|place|pl|way)\b/gi,
    replacement: '[address redacted]',
  },
  {
    name: 'ssn',
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: '[ID redacted]',
  },
  {
    name: 'social_handle',
    pattern: /@[a-zA-Z0-9_.]{1,30}/g,
    replacement: '[handle redacted]',
  },
  {
    name: 'url',
    pattern: /https?:\/\/[^\s]+/gi,
    replacement: '[url redacted]',
  },
  {
    name: 'name_disclosure',
    pattern: /\b(?:my name is|full name is|legal name is|you can call me)\s+[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}/gi,
    replacement: '[name redacted]',
  },
  {
    name: 'workplace',
    pattern: /\b(?:i work at|my workplace is|my company is|my office is|i'm at)\s+[^,.\n]{2,120}/gi,
    replacement: '[workplace redacted]',
  },
];

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

  const lowerText = text.toLowerCase();
  for (const kw of PII_KEYWORDS) {
    if (lowerText.includes(kw) && !flaggedPatterns.includes('keyword')) {
      flaggedPatterns.push('keyword');
    }
  }

  return {
    clean: result,
    hasPii: flaggedPatterns.length > 0,
    flaggedPatterns,
  };
}

export function strictPiiCheck(text: string, skipPatterns?: string[]): string | null {
  const { flaggedPatterns } = scanAndRedact(text);
  const relevant = skipPatterns
    ? flaggedPatterns.filter((pattern) => !skipPatterns.includes(pattern))
    : flaggedPatterns;
  return relevant.length > 0 ? relevant[0] : null;
}
