/**
 * Chunk File Naming Utilities
 *
 * Standalone utilities for generating chunk filenames, parsing chunk indices,
 * and sorting chunk files. Used for transcript storage when files exceed size limits.
 *
 * Ported from Go: agent/chunking.go
 */

/** Chunk suffix format: ".001", ".002", etc. */
const CHUNK_SUFFIX_REGEX = /\.(\d{3})$/;

/**
 * Returns the filename for a chunk at the given index.
 * Index 0 returns the base filename, index 1+ returns with chunk suffix.
 */
export function chunkFileName(baseName: string, index: number): string {
  if (index === 0) return baseName;
  return baseName + '.' + String(index).padStart(3, '0');
}

/**
 * Extracts the chunk index from a filename.
 * Returns 0 for the base file (no suffix), or the chunk number for suffixed files.
 * Returns -1 if the filename doesn't match the expected pattern.
 */
export function parseChunkIndex(filename: string, baseName: string): number {
  if (filename === baseName) return 0;

  if (!filename.startsWith(baseName + '.')) return -1;

  const suffix = filename.slice(baseName.length);
  const match = suffix.match(CHUNK_SUFFIX_REGEX);
  if (!match) return -1;

  return parseInt(match[1], 10);
}

/**
 * Sorts chunk filenames in order (base file first, then numbered chunks).
 * Returns a new sorted array; does not modify the input.
 */
export function sortChunkFiles(files: string[], baseName: string): string[] {
  return [...files].sort((a, b) => {
    const idxA = parseChunkIndex(a, baseName);
    const idxB = parseChunkIndex(b, baseName);
    return idxA - idxB;
  });
}
