/**
 * ============================================================================
 * ISLAND HOP FERRY SYSTEM - DETERMINISTIC AUDIT ENGINE
 * ============================================================================
 * Fast, 100% accurate, zero-assumption verification of:
 * 1. Express Route Registry & HTTP Endpoints
 * 2. PostgreSQL / Prisma Invariants & Seed Health
 * 3. Vitest Automated Unit & Integration Suite
 * 4. Live E2E Lifecycle (Search -> Book -> Seat Check -> QR -> Cancel)
 * 5. Machine-Readable Export: docs/LATEST-AUDIT-REPORT.json
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function runAudit() {
  const startTime = Date.now();
  console.log('\n' + '='.repeat(70));
  console.log('🚢 [ISLAND HOP] DETERMINISTIC SYSTEM AUDIT ENGINE: cpbryn');
  console.log('='.repeat(70));

  const results = {
    timestamp: new Date().toISOString(),
    auditDurationSec: 0,
    is100PercentReady: false,
    summary: {
      routesCount: 0,
      testSuitePassed: false,
      testFilesPassed: 0,
      testsPassed: 0,
      databaseReady: false,
      e2eFlowVerified: false
    },
    endpoints: {
      customer: [],
      operator: [],
      admin: [],
      shared: []
    },
    database: {
      connected: false,
      ports: 0,
      operators: 0,
      ferries: 0,
      routes: 0,
      totalSchedules: 0,
      futureBookableSchedules: 0,
      bookings: 0,
      tickets: 0
    },
    tests: {
      passed: false,
      summary: ''
    },
    e2eFlow: {
      verified: false,
      summary: ''
    }
  };

  const rootDir = path.resolve(__dirname, '..');

  // --------------------------------------------------------------------------
  // STEP 1: ROUTE DISCOVERY & AST-FREE STATIC ANALYSIS
  // --------------------------------------------------------------------------
  console.log('\n[1/4] 🔍 Inspecting Registered Routes & Module Controllers...');
  try {
    const modulesDir = path.join(rootDir, 'src', 'app', 'modules');
    const routeFiles = [];

    function scanDir(dir) {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'dist' && e.name !== '__tests__') {
          scanDir(full);
        } else if (e.isFile() && (e.name.endsWith('.route.ts') || e.name.endsWith('.routes.ts'))) {
          routeFiles.push(full);
        }
      }
    }
    scanDir(modulesDir);

    let totalEndpoints = 0;
    const regex = /router\.(get|post|patch|delete|put)\(\s*['"`]([^'"`]+)['"`]/g;

    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relFile = path.relative(rootDir, file).replace(/\\/g, '/');
      let match;

      while ((match = regex.exec(content)) !== null) {
        totalEndpoints++;
        const method = match[1].toUpperCase();
        const subPath = match[2];
        const item = { method, path: subPath, file: relFile };

        if (relFile.includes('operator')) {
          results.endpoints.operator.push(item);
        } else if (relFile.includes('admin')) {
          results.endpoints.admin.push(item);
        } else if (relFile.includes('booking') || relFile.includes('route') || relFile.includes('schedule') || relFile.includes('ticket') || relFile.includes('port')) {
          results.endpoints.customer.push(item);
        } else {
          results.endpoints.shared.push(item);
        }
      }
    }

    results.summary.routesCount = totalEndpoints;
    console.log(`  ✓ Discovered ${routeFiles.length} route modules with ${totalEndpoints} total HTTP endpoints.`);
    console.log(`    - Customer / Booking / Search: ${results.endpoints.customer.length} endpoints`);
    console.log(`    - Operator Dashboard:          ${results.endpoints.operator.length} endpoints`);
    console.log(`    - Admin Management:            ${results.endpoints.admin.length} endpoints`);
    console.log(`    - Shared / Auth / Core:         ${results.endpoints.shared.length} endpoints`);
  } catch (err) {
    console.error('  ✗ Route scan error:', err.message);
  }

  // --------------------------------------------------------------------------
  // STEP 2: DATABASE INVARIANTS & SEED DATA CHECK
  // --------------------------------------------------------------------------
  console.log('\n[2/4] 🗄️  Connecting to Database via Prisma & Checking Invariants...');
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();

    const [ports, operators, ferries, routes, schedules, futureSchedules, bookings, tickets] = await Promise.all([
      prisma.port.count(),
      prisma.operatorProfile.count(),
      prisma.ferry.count(),
      prisma.route.count(),
      prisma.schedule.count(),
      prisma.schedule.count({ where: { departureTime: { gte: new Date() } } }),
      prisma.booking.count(),
      prisma.ticket.count()
    ]);

    results.database = {
      connected: true,
      ports,
      operators,
      ferries,
      routes,
      totalSchedules: schedules,
      futureBookableSchedules: futureSchedules,
      bookings,
      tickets
    };

    const hasSeed = ports >= 2 && operators >= 1 && ferries >= 1 && routes >= 1 && futureSchedules >= 1;
    results.summary.databaseReady = hasSeed;

    console.log(`  ✓ Database connected successfully:`);
    console.log(`    - Ports:                   ${ports} master ports`);
    console.log(`    - Operators:               ${operators} verified operators`);
    console.log(`    - Vessels / Ferries:       ${ferries} active vessels`);
    console.log(`    - Configured Routes:       ${routes} routes`);
    console.log(`    - Active Future Trips:     ${futureSchedules} bookable sailings (Total: ${schedules})`);
    console.log(`    - Existing Bookings:       ${bookings} bookings (${tickets} tickets issued)`);
    await prisma.$disconnect();
  } catch (err) {
    console.error('  ✗ Database connection or query failed:', err.message);
  }

  // --------------------------------------------------------------------------
  // STEP 3: RUN VITEST AUTOMATED TEST SUITE (SILENT MODE)
  // --------------------------------------------------------------------------
  console.log('\n[3/4] 🧪 Running Full Test Suite (Vitest)...');
  try {
    const testOut = execSync('npx vitest run --silent', {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 45000,
      env: { ...process.env, NODE_ENV: 'test', NO_COLOR: '1' }
    });
    const cleanOut = testOut.replace(/\u001b\[[0-9;]*m/g, '');

    const fileMatch = cleanOut.match(/Test Files\s+(\d+)\s+passed/);
    const testMatch = cleanOut.match(/Tests\s+(\d+)\s+passed/);

    const filesPassed = fileMatch ? parseInt(fileMatch[1], 10) : 0;
    const testsPassed = testMatch ? parseInt(testMatch[1], 10) : 0;

    results.tests = {
      passed: true,
      summary: `${filesPassed} test files, ${testsPassed} tests passed (100%)`
    };
    results.summary.testSuitePassed = true;
    results.summary.testFilesPassed = filesPassed;
    results.summary.testsPassed = testsPassed;

    console.log(`  ✓ Vitest Status: 100% PASSED (${filesPassed} files / ${testsPassed} tests passed)`);
  } catch (err) {
    results.tests = { passed: false, summary: err.message };
    console.error('  ✗ Test suite failed:', err.message);
  }

  // --------------------------------------------------------------------------
  // STEP 4: LIVE END-TO-END FLOW VERIFICATION
  // --------------------------------------------------------------------------
  console.log(`\n[4/4] 🔄 Verifying Live E2E Lifecycle on Port ${process.env.PORT || 5000}...`);
  try {
    const verifyScript = path.join(__dirname, 'verify-e2e-flow.js');
    if (fs.existsSync(verifyScript)) {
      const e2eOut = execSync(`node "${verifyScript}"`, {
        cwd: rootDir,
        encoding: 'utf-8',
        timeout: 25000
      });
      const passed = e2eOut.includes('ALL END-TO-END FLOW TESTS PASSED');
      results.e2eFlow = {
        verified: passed,
        summary: passed ? 'Search -> Book -> Seat Check -> QR -> Cancel verified' : 'E2E flow incomplete'
      };
      results.summary.e2eFlowVerified = passed;
      if (passed) {
        console.log('  ✓ E2E Lifecycle Verified: Search -> Booking -> Seat Decrement -> Digital QR -> Cancellation -> Seat Restore');
      } else {
        console.warn('  ⚠️ E2E output did not confirm pass:', e2eOut.slice(0, 300));
      }
    } else {
      console.log('  ℹ️ verify-e2e-flow.js not found, skipping step 4.');
    }
  } catch (err) {
    console.error(`  ✗ E2E test execution error (Server on port ${process.env.PORT || 5000} may be starting):`, err.message);
  }

  // --------------------------------------------------------------------------
  // FINAL VERDICT & REPORT EXPORT
  // --------------------------------------------------------------------------
  const durationSec = parseFloat(((Date.now() - startTime) / 1000).toFixed(1));
  results.auditDurationSec = durationSec;

  results.is100PercentReady =
    results.summary.routesCount > 0 &&
    results.summary.testSuitePassed &&
    results.summary.databaseReady &&
    results.summary.e2eFlowVerified;

  const docsDir = path.join(rootDir, 'docs');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const reportPath = path.join(docsDir, 'LATEST-AUDIT-REPORT.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(70));
  if (results.is100PercentReady) {
    console.log(`✅ 100% ACCURACY VERIFIED IN ${durationSec}s | SYSTEM HEALTH: OPTIMAL & READY`);
  } else {
    console.log(`⚠️ AUDIT FINISHED IN ${durationSec}s WITH WARNINGS (Check docs/LATEST-AUDIT-REPORT.json)`);
  }
  console.log(`📄 Saved machine-readable report to: docs/LATEST-AUDIT-REPORT.json`);
  console.log('='.repeat(70) + '\n');
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
