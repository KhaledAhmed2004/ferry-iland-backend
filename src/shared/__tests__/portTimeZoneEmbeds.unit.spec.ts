import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Spec 0003, rule 4: every response that embeds a trip's ports must carry the port's
 * `timeZone`, or the frontend cannot show port local times. A Prisma `select` or a hand built
 * `{ id, name }` port object silently drops it, so this guard scans the modules for both shapes.
 * Loading the whole port (`departurePort: true`) always includes it and is not flagged.
 */

const MODULES_DIR = path.resolve(__dirname, '../../app/modules');

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap(entry => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });

const PORT_SELECT = /(departurePort|destinationPort):\s*\{\s*select:\s*\{([^}]*)\}/g;
const PORT_OBJECT = /(departurePort|destinationPort):\s*\{\s*id:([^}]*)\}/g;

describe('port time zone embeds (spec 0003, rule 4)', () => {
  it('every port select and hand built port object includes timeZone', () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of sourceFiles(MODULES_DIR)) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of [PORT_SELECT, PORT_OBJECT]) {
        for (const match of source.matchAll(pattern)) {
          checked += 1;
          if (!match[2].includes('timeZone')) {
            const line = source.slice(0, match.index).split('\n').length;
            offenders.push(`${path.relative(MODULES_DIR, file)}:${line} ${match[1]}`);
          }
        }
      }
    }

    // The scan must actually find the selects it guards, or a regex drift would pass silently.
    expect(checked).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});
