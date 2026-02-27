/**
 * Secret Redaction
 *
 * Multi-layered secret detection and redaction for transcripts.
 * Uses both entropy-based detection and pattern matching
 * for known secret formats.
 */

// ============================================================================
// Constants
// ============================================================================

const ENTROPY_THRESHOLD = 4.5;
const MIN_SECRET_LENGTH = 10;
const REDACTED_PLACEHOLDER = 'REDACTED';

/** High-entropy alphanumeric pattern (potential secrets) */
const HIGH_ENTROPY_PATTERN = /[A-Za-z0-9+_=-]{10,}/g;

// ============================================================================
// Known Secret Patterns (subset of gitleaks rules)
// ============================================================================

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // API Keys
  {
    name: 'aws-access-key',
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
  },
  {
    name: 'aws-secret-key',
    pattern:
      /(?:aws_secret_access_key|aws_secret_key|secret_key)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})["']?/gi,
  },
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9_]{36,255}/g },
  { name: 'github-fine-grained', pattern: /github_pat_[A-Za-z0-9_]{22,255}/g },
  { name: 'gitlab-token', pattern: /glpat-[A-Za-z0-9=_-]{20,}/g },
  { name: 'google-api-key', pattern: /AIza[A-Za-z0-9_-]{35}/g },
  { name: 'slack-token', pattern: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34}/g },
  {
    name: 'slack-webhook',
    pattern:
      /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{10}\/B[A-Z0-9]{10}\/[a-zA-Z0-9]{24}/g,
  },
  { name: 'stripe-key', pattern: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,99}/g },
  { name: 'twilio-api-key', pattern: /SK[0-9a-fA-F]{32}/g },
  { name: 'sendgrid-api-key', pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g },
  { name: 'npm-token', pattern: /npm_[A-Za-z0-9]{36}/g },
  { name: 'pypi-token', pattern: /pypi-[A-Za-z0-9_-]{100,}/g },

  // Cloud Providers
  {
    name: 'azure-connection-string',
    pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{88};/g,
  },
  {
    name: 'gcp-service-account',
    pattern: /"private_key":\s*"-----BEGIN (?:RSA )?PRIVATE KEY-----/g,
  },

  // Generic Secrets
  { name: 'private-key', pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g },
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'basic-auth', pattern: /(?:basic|bearer)\s+[A-Za-z0-9+/=]{20,}/gi },
  { name: 'password-in-url', pattern: /[a-zA-Z]{3,10}:\/\/[^/\s:@]{3,20}:[^/\s@]{3,20}@/g },

  // Anthropic
  { name: 'anthropic-api-key', pattern: /sk-ant-[A-Za-z0-9_-]{90,}/g },

  // OpenAI
  { name: 'openai-api-key', pattern: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g },

  // Database
  { name: 'postgres-url', pattern: /postgres(?:ql)?:\/\/[^/\s:@]+:[^/\s@]+@[^/\s]+\/[^/\s]+/g },
  { name: 'mysql-url', pattern: /mysql:\/\/[^/\s:@]+:[^/\s@]+@[^/\s]+\/[^/\s]+/g },
  { name: 'mongodb-url', pattern: /mongodb(?:\+srv)?:\/\/[^/\s:@]+:[^/\s@]+@[^/\s]+/g },

  // Hex-encoded secrets (generic)
  {
    name: 'hex-secret',
    pattern: /(?:secret|token|key|password|api_key|apikey)\s*[=:]\s*["']?([0-9a-fA-F]{32,})["']?/gi,
  },
];

// Fields that should be skipped during redaction
const SAFE_FIELDS = new Set([
  'signature',
  'id',
  'uuid',
  'sessionId',
  'session_id',
  'checkpointId',
  'checkpoint_id',
  'nodeId',
  'node_id',
  'toolUseId',
  'tool_use_id',
  'file_path',
  'filePath',
  'path',
  'name',
  'type',
  'role',
]);

// ============================================================================
// Entropy Calculation
// ============================================================================

/**
 * Calculate Shannon entropy of a string
 */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    if (p > 0) entropy -= p * Math.log2(p);
  }

  return entropy;
}

// ============================================================================
// Redaction Region
// ============================================================================

interface RedactionRegion {
  start: number;
  end: number;
  source: string;
}

/**
 * Merge overlapping regions
 */
function mergeRegions(regions: RedactionRegion[]): RedactionRegion[] {
  if (regions.length === 0) return [];

  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const merged: RedactionRegion[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push(sorted[i]);
    }
  }

  return merged;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect secret regions in a string
 */
export function detectSecrets(text: string): RedactionRegion[] {
  const regions: RedactionRegion[] = [];

  // Entropy-based detection
  for (const match of text.matchAll(HIGH_ENTROPY_PATTERN)) {
    const value = match[0];
    if (value.length < MIN_SECRET_LENGTH) continue;
    if (shannonEntropy(value) >= ENTROPY_THRESHOLD) {
      regions.push({
        start: match.index!,
        end: match.index! + value.length,
        source: 'entropy',
      });
    }
  }

  // Pattern-based detection
  for (const { name, pattern } of SECRET_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      regions.push({
        start: match.index!,
        end: match.index! + match[0].length,
        source: name,
      });
    }
  }

  return mergeRegions(regions);
}

/**
 * Redact secrets from a plain string
 */
export function redactString(text: string): string {
  const regions = detectSecrets(text);
  if (regions.length === 0) return text;

  let result = '';
  let pos = 0;

  for (const region of regions) {
    result += text.slice(pos, region.start);
    result += REDACTED_PLACEHOLDER;
    pos = region.end;
  }

  result += text.slice(pos);
  return result;
}

/**
 * Redact secrets from a Buffer
 */
export function redactBuffer(buf: Buffer): Buffer {
  return Buffer.from(redactString(buf.toString('utf-8')));
}

/**
 * Redact secrets from JSONL content (line by line)
 * Preserves JSON structure and skips safe fields
 */
export function redactJSONL(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    if (!line.trim()) {
      result.push(line);
      continue;
    }

    try {
      const parsed = JSON.parse(line);
      const redacted = redactJSONValue(parsed);
      result.push(JSON.stringify(redacted));
    } catch {
      // Not valid JSON, redact as plain text
      result.push(redactString(line));
    }
  }

  return result.join('\n');
}

/**
 * Recursively redact values in a JSON object
 */
function redactJSONValue(value: unknown, key?: string): unknown {
  // Skip safe fields
  if (key && SAFE_FIELDS.has(key)) return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactJSONValue(item));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Skip image/base64 objects
    if (obj.type === 'image' || obj.type === 'base64') return value;

    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = redactJSONValue(v, k);
    }
    return result;
  }

  return value;
}
