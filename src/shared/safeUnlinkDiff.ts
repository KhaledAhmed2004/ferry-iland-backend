import unlinkFile from './unlinkFile';

// Normalize leading slashes so path.join('uploads', file) works cross-platform
const normalize = (p?: string) => (p ? p.replace(/^\/+/, '') : '');

/**
 * Remove files that exist in `oldList` but not in `newList`.
 * Returns number of files removed.
 */
export const safeUnlinkDiff = (
  oldList: string[] = [],
  newList: string[] = []
): number => {
  const oldSet = new Set((oldList || []).filter(Boolean));
  const newSet = new Set((newList || []).filter(Boolean));
  let removed = 0;

  for (const file of oldSet) {
    if (!newSet.has(file)) {
      unlinkFile(normalize(file));
      removed += 1;
    }
  }

  return removed;
};

export default safeUnlinkDiff;
