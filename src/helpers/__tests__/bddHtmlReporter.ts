import fs from 'fs';
import path from 'path';

export interface IBddSpec {
  id: string;
  title: string;
  userStory?: string;
  businessRules?: string;
  scenario?: string;
  apiCalls: IApiCallRecord[];
  status: 'PASSED' | 'FAILED';
  durationMs?: number;
  timestamp: string;
}

export interface IApiCallRecord {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  resolvedUrl?: string;
  request: {
    params?: any;
    query?: any;
    headers?: any;
    body?: any;
  };
  response: any;
  statusCode?: number;
  badge?: string | number;
  description?: string;
  timestamp: string;
}

class BddReportCollector {
  private currentSpec: IBddSpec | null = null;
  private specs: IBddSpec[] = [];
  private startTime: number = Date.now();

  public startSpec(id: string, title: string) {
    if (this.currentSpec) {
      this.specs.push(this.currentSpec);
    }
    this.currentSpec = {
      id,
      title,
      apiCalls: [],
      status: 'PASSED',
      timestamp: new Date().toISOString(),
    };
  }

  public setSpecDetails(details: {
    userStory?: string;
    businessRules?: string;
    scenario?: string;
  }) {
    if (!this.currentSpec) {
      this.startSpec('BDD-SPEC', 'BDD Specification');
    }
    if (this.currentSpec) {
      if (details.userStory) this.currentSpec.userStory = details.userStory;
      if (details.businessRules)
        this.currentSpec.businessRules = details.businessRules;
      if (details.scenario) this.currentSpec.scenario = details.scenario;
    }
  }

  public parseAndSetBddDoc(id?: string, title?: string, rawText: string = '') {
    // Strip ANSI codes from rawText
    const cleanText = rawText.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');

    let userStory = '';
    let businessRules = '';
    let scenario = '';

    const storyMatch = cleanText.match(
      /📝\s*USER STORY:([\s\S]*?)(?=📋\s*BUSINESS RULES|📖\s*BDD SCENARIO|$)/i,
    );
    if (storyMatch) userStory = storyMatch[1].trim();

    const rulesMatch = cleanText.match(
      /📋\s*BUSINESS RULES[\s\S]*?:([\s\S]*?)(?=📖\s*BDD SCENARIO|$)/i,
    );
    if (rulesMatch) businessRules = rulesMatch[1].trim();

    const scenarioMatch = cleanText.match(
      /📖\s*BDD SCENARIO[\s\S]*?:([\s\S]*?)$/i,
    );
    if (scenarioMatch) scenario = scenarioMatch[1].trim();

    let stageId = id || 'BDD-SPEC';
    let specTitle = title || 'BDD Specification';

    const scenarioHeaderMatch = cleanText.match(
      /📖\s*BDD SCENARIO:\s*([^\n\r]+)/i,
    );
    if (scenarioHeaderMatch) {
      const fullScenarioTitle = scenarioHeaderMatch[1].trim();
      if (fullScenarioTitle.includes('—')) {
        const parts = fullScenarioTitle.split('—');
        stageId = parts[0].trim();
        specTitle = parts[1].trim();
      } else if (fullScenarioTitle.includes(':')) {
        const parts = fullScenarioTitle.split(':');
        stageId = parts[0].trim();
        specTitle = parts.slice(1).join(':').trim();
      } else {
        stageId = fullScenarioTitle;
      }
    }

    const featureMatch = cleanText.match(/Feature:\s*([^\n\r]+)/i);
    if (featureMatch && (!specTitle || specTitle === 'BDD Specification')) {
      specTitle = featureMatch[1].trim();
    }

    this.startSpec(stageId, specTitle);
    this.setSpecDetails({
      userStory: userStory || undefined,
      businessRules: businessRules || undefined,
      scenario: scenario || cleanText.trim(),
    });
  }

  public recordApiCall(apiCall: IApiCallRecord) {
    if (!this.currentSpec) {
      this.startSpec(
        apiCall.badge ? String(apiCall.badge) : 'API-CALL',
        apiCall.description || `${apiCall.method} ${apiCall.url}`,
      );
    }
    if (this.currentSpec) {
      this.currentSpec.apiCalls.push(apiCall);
    }
  }

  public finishCurrentSpec(status: 'PASSED' | 'FAILED' = 'PASSED') {
    if (this.currentSpec) {
      this.currentSpec.status = status;
      this.specs.push(this.currentSpec);
      this.currentSpec = null;
    }
  }

  public getSpecs(): IBddSpec[] {
    const all = [...this.specs];
    if (this.currentSpec) {
      all.push(this.currentSpec);
    }
    return all;
  }

  public clear() {
    this.specs = [];
    this.currentSpec = null;
    this.startTime = Date.now();
  }

  public generateHtml(): string {
    const specs = this.getSpecs();
    const totalSpecs = specs.length;
    const passedSpecs = specs.filter(s => s.status === 'PASSED').length;
    const failedSpecs = specs.filter(s => s.status === 'FAILED').length;
    const totalApiCalls = specs.reduce((acc, s) => acc + s.apiCalls.length, 0);
    const passPercentage =
      totalSpecs > 0 ? Math.round((passedSpecs / totalSpecs) * 100) : 100;
    const executionDuration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    const reportDate = new Date().toLocaleString();

    // Calculate method statistics
    let getCount = 0;
    let postCount = 0;
    let patchCount = 0;
    let deleteCount = 0;
    let putCount = 0;

    specs.forEach(s => {
      s.apiCalls.forEach(c => {
        if (c.method === 'GET') getCount++;
        else if (c.method === 'POST') postCount++;
        else if (c.method === 'PATCH') patchCount++;
        else if (c.method === 'DELETE') deleteCount++;
        else if (c.method === 'PUT') putCount++;
      });
    });

    const getPct = totalApiCalls > 0 ? (getCount / totalApiCalls) * 100 : 0;
    const postPct = totalApiCalls > 0 ? (postCount / totalApiCalls) * 100 : 0;
    const patchPct = totalApiCalls > 0 ? (patchCount / totalApiCalls) * 100 : 0;
    const deletePct =
      totalApiCalls > 0 ? (deleteCount / totalApiCalls) * 100 : 0;

    const specsJson = JSON.stringify(specs).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>BDD & API Test Execution Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-main: #070A11;
      --bg-card: rgba(17, 24, 39, 0.82);
      --bg-card-hover: rgba(23, 33, 52, 0.95);
      --bg-subtle: rgba(31, 41, 55, 0.7);
      --bg-header: rgba(13, 18, 30, 0.88);
      --border-color: rgba(55, 65, 81, 0.6);
      --border-glow: rgba(56, 189, 248, 0.35);
      --border-focus: #38BDF8;
      
      --text-primary: #F9FAFB;
      --text-secondary: #94A3B8;
      --text-muted: #64748B;
      
      --color-get: #10B981;
      --color-post: #F59E0B;
      --color-put: #06B6D4;
      --color-patch: #8B5CF6;
      --color-delete: #EF4444;
      
      --color-pass: #10B981;
      --color-fail: #EF4444;
      --color-accent: #3B82F6;
      --color-cyan: #00F0FF;
      --color-purple: #A855F7;
      --color-pink: #EC4899;
      --color-gold: #EAB308;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-main);
      background-image: 
        radial-gradient(at 0% 0%, rgba(56, 189, 248, 0.08) 0px, transparent 50%),
        radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.08) 0px, transparent 50%),
        radial-gradient(at 50% 100%, rgba(16, 185, 129, 0.05) 0px, transparent 50%);
      background-attachment: fixed;
      color: var(--text-primary);
      line-height: 1.5;
      padding: 28px;
      min-height: 100vh;
    }

    .container {
      max-width: 1320px;
      margin: 0 auto;
    }

    /* HEADER DASHBOARD WITH GLASSMORPHISM & NEON */
    header {
      background: var(--bg-header);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 20px;
      padding: 26px 32px;
      margin-bottom: 24px;
      box-shadow: 0 15px 35px -5px rgba(0, 0, 0, 0.6), 0 0 30px rgba(56, 189, 248, 0.05);
      position: relative;
      overflow: hidden;
    }

    header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, #00F0FF, #A855F7, #EC4899, #10B981);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 24px;
    }

    .header-title h1 {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.02em;
      background: linear-gradient(135deg, #00F0FF 0%, #A855F7 50%, #EC4899 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .header-meta {
      font-size: 13px;
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .meta-tag {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 10px;
      border-radius: 6px;
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      color: #E2E8F0;
    }

    /* STATS & PASS-RATE RING SECTION */
    .dashboard-overview {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 24px;
      align-items: center;
    }

    @media (max-width: 900px) {
      .dashboard-overview {
        grid-template-columns: 1fr;
      }
    }

    .pass-rate-card {
      background: rgba(16, 185, 129, 0.05);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 16px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      position: relative;
      box-shadow: 0 0 25px rgba(16, 185, 129, 0.12);
    }

    .circular-meter {
      position: relative;
      width: 110px;
      height: 110px;
    }

    .circular-meter svg {
      width: 110px;
      height: 110px;
      transform: rotate(-90deg);
    }

    .circular-meter circle {
      fill: none;
      stroke-width: 8;
    }

    .meter-bg {
      stroke: rgba(255, 255, 255, 0.08);
    }

    .meter-progress {
      stroke: var(--color-pass);
      stroke-linecap: round;
      stroke-dasharray: 283;
      stroke-dashoffset: ${283 - (283 * passPercentage) / 100};
      filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.8));
      transition: stroke-dashoffset 1s ease-out;
    }

    .meter-content {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .meter-percent {
      font-size: 20px;
      font-weight: 900;
      color: #fff;
    }

    .meter-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--color-pass);
    }

    .stats-and-breakdown {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px;
    }

    .stat-card {
      background: var(--bg-subtle);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: transform 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .stat-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }

    .stat-val {
      font-size: 22px;
      font-weight: 900;
      color: var(--text-primary);
    }

    .stat-val.passed { color: var(--color-pass); text-shadow: 0 0 10px rgba(16, 185, 129, 0.4); }
    .stat-val.failed { color: var(--color-fail); text-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }

    /* METHOD BREAKDOWN PROGRESS BAR */
    .method-breakdown-wrapper {
      background: var(--bg-subtle);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .method-breakdown-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .method-bar {
      height: 10px;
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      overflow: hidden;
      display: flex;
    }

    .method-bar-seg {
      height: 100%;
      transition: width 0.6s ease;
    }

    .method-bar-seg.get { background: var(--color-get); }
    .method-bar-seg.post { background: var(--color-post); }
    .method-bar-seg.patch { background: var(--color-patch); }
    .method-bar-seg.delete { background: var(--color-delete); }

    .method-legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 12px;
      font-family: 'Fira Code', monospace;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .legend-dot.get { background: var(--color-get); box-shadow: 0 0 6px var(--color-get); }
    .legend-dot.post { background: var(--color-post); box-shadow: 0 0 6px var(--color-post); }
    .legend-dot.patch { background: var(--color-patch); box-shadow: 0 0 6px var(--color-patch); }
    .legend-dot.delete { background: var(--color-delete); box-shadow: 0 0 6px var(--color-delete); }

    /* CONTROLS BAR */
    .controls-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 20px;
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 14px 20px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }

    .search-box {
      flex: 1;
      min-width: 260px;
      position: relative;
    }

    .search-input {
      width: 100%;
      background: rgba(15, 23, 42, 0.8);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 11px 16px 11px 42px;
      font-size: 15px;
      color: var(--text-primary);
      outline: none;
      transition: all 0.2s;
    }

    .search-input:focus {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.25), 0 0 15px rgba(56, 189, 248, 0.15);
    }

    .search-icon {
      position: absolute;
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      font-size: 16px;
    }

    .filter-group {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-btn {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }

    .filter-btn:hover, .filter-btn.active {
      background: linear-gradient(135deg, #2563EB, #3B82F6);
      color: #fff;
      border-color: #60A5FA;
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.4);
    }

    .action-btn {
      background: var(--bg-subtle);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .action-btn:hover {
      background: #374151;
      border-color: #6B7280;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.1);
    }

    .action-btn.stories-btn {
      background: linear-gradient(135deg, rgba(6, 182, 212, 0.2), rgba(59, 130, 246, 0.2));
      border: 1px solid rgba(6, 182, 212, 0.4);
      color: #38BDF8;
    }

    .action-btn.stories-btn:hover {
      background: linear-gradient(135deg, #06B6D4, #3B82F6);
      color: #fff;
      border-color: #38BDF8;
      box-shadow: 0 0 15px rgba(56, 189, 248, 0.4);
    }

    .action-btn.print-btn {
      background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(236, 72, 153, 0.2));
      border: 1px solid rgba(168, 85, 247, 0.4);
      color: #F472B6;
    }

    .action-btn.print-btn:hover {
      background: linear-gradient(135deg, #A855F7, #EC4899);
      color: #fff;
      box-shadow: 0 0 15px rgba(236, 72, 153, 0.4);
    }

    /* BDD STAGE ACCORDION CARDS WITH NEON GLOW */
    .specs-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .spec-card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
    }

    .spec-card:hover {
      border-color: var(--border-glow);
      box-shadow: 0 0 20px rgba(56, 189, 248, 0.18), 0 8px 25px rgba(0, 0, 0, 0.4);
      transform: translateY(-1px);
    }

    .spec-card.open {
      border-color: rgba(56, 189, 248, 0.5);
      box-shadow: 0 0 25px rgba(56, 189, 248, 0.15), 0 10px 30px rgba(0, 0, 0, 0.5);
    }

    .spec-header {
      padding: 16px 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      cursor: pointer;
      user-select: none;
      background: transparent;
      transition: background-color 0.2s;
    }

    .spec-header:hover {
      background-color: var(--bg-card-hover);
    }

    .spec-title-area {
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex: 1;
    }

    .spec-title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .spec-endpoints-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .stage-badge {
      background: rgba(99, 102, 241, 0.18);
      color: #A5B4FC;
      font-family: 'Fira Code', monospace;
      font-size: 13px;
      font-weight: 800;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid rgba(99, 102, 241, 0.4);
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.2);
    }

    .spec-title {
      font-size: 17px;
      font-weight: 700;
      color: var(--text-primary);
    }

    .method-pill {
      font-family: 'Fira Code', monospace;
      font-size: 12px;
      font-weight: 800;
      padding: 4px 9px;
      border-radius: 5px;
      color: #000;
      letter-spacing: 0.02em;
    }

    .method-pill.GET { background: var(--color-get); box-shadow: 0 0 8px rgba(16, 185, 129, 0.4); }
    .method-pill.POST { background: var(--color-post); box-shadow: 0 0 8px rgba(245, 158, 11, 0.4); }
    .method-pill.PUT { background: var(--color-put); box-shadow: 0 0 8px rgba(6, 182, 212, 0.4); }
    .method-pill.PATCH { background: var(--color-patch); color: #fff; box-shadow: 0 0 8px rgba(139, 92, 246, 0.4); }
    .method-pill.DELETE { background: var(--color-delete); color: #fff; box-shadow: 0 0 8px rgba(239, 68, 68, 0.4); }

    .api-pill-group {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(15, 23, 42, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 4px 10px;
      border-radius: 7px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
    }

    .endpoint-pill {
      font-family: 'Fira Code', monospace;
      font-size: 14px;
      font-weight: 600;
      color: #38BDF8;
      letter-spacing: -0.01em;
    }

    /* STATUS CODE BADGES */
    .status-code-pill {
      font-family: 'Fira Code', monospace;
      font-size: 12.5px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .status-code-pill.status-200, .status-code-pill.status-201, .status-code-pill.status-202 {
      background: rgba(16, 185, 129, 0.15);
      color: #34D399;
      border: 1px solid rgba(16, 185, 129, 0.4);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
    }

    .status-code-pill.status-400, .status-code-pill.status-401, .status-code-pill.status-403, .status-code-pill.status-429 {
      background: rgba(239, 68, 68, 0.15);
      color: #F87171;
      border: 1px solid rgba(239, 68, 68, 0.4);
      box-shadow: 0 0 8px rgba(239, 68, 68, 0.2);
    }

    .status-code-pill.status-409 {
      background: rgba(168, 85, 247, 0.18);
      color: #C084FC;
      border: 1px solid rgba(168, 85, 247, 0.4);
      box-shadow: 0 0 8px rgba(168, 85, 247, 0.2);
    }

    .status-badge {
      font-size: 12.5px;
      font-weight: 800;
      padding: 5px 12px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .status-badge.passed {
      background: rgba(16, 185, 129, 0.15);
      color: var(--color-pass);
      border: 1px solid rgba(16, 185, 129, 0.4);
      box-shadow: 0 0 10px rgba(16, 185, 129, 0.25);
    }

    .status-badge.failed {
      background: rgba(239, 68, 68, 0.15);
      color: var(--color-fail);
      border: 1px solid rgba(239, 68, 68, 0.4);
      box-shadow: 0 0 10px rgba(239, 68, 68, 0.25);
    }

    .expand-icon {
      color: var(--text-secondary);
      font-size: 16px;
      transition: transform 0.3s ease;
    }

    .spec-card.open .expand-icon {
      transform: rotate(180deg);
      color: var(--color-cyan);
    }

    /* CARD BODY (COLLAPSIBLE CONTENT) */
    .spec-body {
      display: none;
      padding: 22px;
      background: rgba(9, 13, 22, 0.9);
      border-top: 1px solid var(--border-color);
      gap: 20px;
      flex-direction: column;
    }

    .spec-card.open .spec-body {
      display: flex;
    }

    /* BDD DOCS PANELS */
    .doc-panel {
      background: rgba(17, 24, 39, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 16px;
    }

    .doc-panel-header {
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .doc-panel-header.story { color: var(--color-cyan); text-shadow: 0 0 8px rgba(0, 240, 255, 0.4); }
    .doc-panel-header.rules { color: var(--color-post); text-shadow: 0 0 8px rgba(245, 158, 11, 0.4); }
    .doc-panel-header.scenario { color: var(--color-purple); text-shadow: 0 0 8px rgba(168, 85, 247, 0.4); }

    .doc-panel-content {
      font-size: 14.5px;
      color: #CBD5E1;
      white-space: pre-wrap;
      font-family: 'Fira Code', monospace;
      line-height: 1.8;
      background: #060910;
      padding: 18px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.5);
    }

    /* COLORFUL RULES & BDD STYLING */
    .rule-bullet {
      color: #38BDF8;
      font-size: 13px;
      margin-right: 4px;
      text-shadow: 0 0 8px rgba(56, 189, 248, 0.5);
    }

    .rule-cat-header {
      color: #FCD34D;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.01em;
      text-shadow: 0 0 10px rgba(252, 211, 77, 0.25);
    }

    .rule-param {
      color: #6EE7B7;
      font-size: 14px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.12);
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid rgba(16, 185, 129, 0.25);
    }

    .rule-type {
      color: #C084FC;
      font-style: italic;
      font-size: 13px;
    }

    .rule-state {
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 12.5px;
    }

    .rule-state.ACTIVE, .rule-state.VERIFIED, .rule-state.APPROVED {
      color: #34D399;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    .rule-state.INACTIVE, .rule-state.REJECTED, .rule-state.BLOCKED, .rule-state.SUSPENDED {
      color: #F87171;
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }

    .rule-state.PENDING, .rule-state.UNVERIFIED, .rule-state.NOT_ACCEPTED {
      color: #FBBF24;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }

    .const-bool {
      color: #F472B6;
      font-weight: 700;
      font-size: 14px;
    }

    .const-null {
      color: #94A3B8;
      font-style: italic;
      font-size: 14px;
    }

    .rule-inline-json {
      color: #E2E8F0;
      font-size: 14px;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 2px 7px;
      border-radius: 5px;
      display: inline-block;
    }

    /* GHERKIN HIGHLIGHTS */
    .gk-feature { color: #38BDF8; font-size: 15px; font-weight: 800; }
    .gk-feature-title { color: #F1F5F9; font-size: 15px; font-weight: 700; }
    .gk-given { color: #A78BFA; font-size: 15px; font-weight: 800; }
    .gk-when { color: #FBBF24; font-size: 15px; font-weight: 800; }
    .gk-then { color: #34D399; font-size: 15px; font-weight: 800; }
    .gk-and { color: #60A5FA; font-size: 15px; font-weight: 800; }
    .gk-but { color: #F87171; font-size: 15px; font-weight: 800; }
    .gk-text { color: #CBD5E1; font-size: 14.5px; }
    .gk-status {
      color: #34D399;
      font-size: 14px;
      font-weight: 700;
      background: rgba(16, 185, 129, 0.15);
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }

    /* USER STORY HIGHLIGHTS */
    .us-keyword { color: #38BDF8; font-size: 15px; font-weight: 800; }
    .us-role { color: #FCD34D; font-size: 15px; font-weight: 700; }
    .us-action { color: #6EE7B7; font-size: 14.5px; }
    .us-benefit { color: #E2E8F0; font-size: 14.5px; }

    /* API CALL INSPECTOR */
    .api-calls-container {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .api-call-card {
      background: rgba(17, 24, 39, 0.85);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
    }

    .api-call-header {
      padding: 14px 18px;
      background: rgba(22, 32, 50, 0.9);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: 'Fira Code', monospace;
      font-size: 14px;
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
      gap: 10px;
    }

    .api-url-group {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
    }

    .api-badge-tag {
      background: rgba(192, 132, 252, 0.15);
      color: #C084FC;
      border: 1px solid rgba(192, 132, 252, 0.3);
      padding: 3px 9px;
      border-radius: 4px;
      font-size: 12px;
    }

    .api-call-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1px;
      background: var(--border-color);
    }

    @media (max-width: 860px) {
      .api-call-grid {
        grid-template-columns: 1fr;
      }
    }

    .api-box {
      background: #070B12;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .api-box-title {
      font-size: 13px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .copy-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover {
      background: var(--color-accent);
      color: #fff;
      border-color: var(--color-accent);
      box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);
    }

    .copy-card-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border-color);
      color: var(--text-secondary);
      border-radius: 6px;
      padding: 5px 12px;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .copy-card-btn:hover {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--border-focus);
      color: #38BDF8;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.3);
      transform: translateY(-1px);
    }

    .copy-card-btn:active {
      transform: translateY(0);
    }

    .code-viewer {
      font-family: 'Fira Code', monospace;
      font-size: 13.5px;
      line-height: 1.6;
      color: #E5E7EB;
      background: #04060A;
      padding: 14px;
      border-radius: 6px;
      overflow-x: auto;
      max-height: 380px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-secondary);
      font-size: 15px;
    }

    /* PRINT / PDF EXPORT OPTIMIZATIONS */
    @media print {
      body {
        background: #fff !important;
        color: #000 !important;
        padding: 0 !important;
        background-image: none !important;
      }

      .container {
        max-width: 100% !important;
      }

      .controls-bar, .copy-btn, .expand-icon {
        display: none !important;
      }

      header {
        border: 1px solid #ccc !important;
        box-shadow: none !important;
        background: #f8fafc !important;
        color: #000 !important;
      }

      .header-title h1 {
        -webkit-text-fill-color: #0f172a !important;
      }

      .spec-card {
        page-break-inside: avoid;
        border: 1px solid #ccc !important;
        margin-bottom: 20px !important;
        box-shadow: none !important;
        background: #fff !important;
      }

      .spec-body {
        display: flex !important;
        background: #fff !important;
        border-top: 1px solid #ccc !important;
      }

      .doc-panel, .api-call-card, .api-box {
        background: #f8fafc !important;
        border: 1px solid #e2e8f0 !important;
      }

      .doc-panel-content, .code-viewer {
        background: #fff !important;
        color: #000 !important;
        border: 1px solid #e2e8f0 !important;
      }

      .stat-card, .method-breakdown-wrapper {
        background: #f1f5f9 !important;
        border: 1px solid #cbd5e1 !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- HEADER -->
    <header>
      <div class="header-top">
        <div class="header-title">
          <h1>🧪 BDD Lifecycle & API Execution Dashboard</h1>
        </div>
        <div class="header-meta">
          <span class="meta-tag">📅 ${reportDate}</span>
          <span class="meta-tag">⏱ Total Time: ${executionDuration}s</span>
        </div>
      </div>

      <div class="dashboard-overview">
        <!-- PASS RATE CIRCULAR RING -->
        <div class="pass-rate-card">
          <div class="circular-meter">
            <svg viewBox="0 0 100 100">
              <circle class="meter-bg" cx="50" cy="50" r="45" />
              <circle class="meter-progress" cx="50" cy="50" r="45" />
            </svg>
            <div class="meter-content">
              <span class="meter-percent">${passPercentage}%</span>
              <span class="meter-label">${passedSpecs === totalSpecs ? 'PASSED' : 'STABLE'}</span>
            </div>
          </div>
        </div>

        <!-- STATS & METHOD DISTRIBUTION BAR -->
        <div class="stats-and-breakdown">
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-label">Total Stages</span>
              <span class="stat-val">${totalSpecs}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Passed</span>
              <span class="stat-val passed">✔ ${passedSpecs}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Failed</span>
              <span class="stat-val ${failedSpecs > 0 ? 'failed' : ''}">✖ ${failedSpecs}</span>
            </div>
            <div class="stat-card">
              <span class="stat-label">Total API Calls</span>
              <span class="stat-val">${totalApiCalls}</span>
            </div>
          </div>

          <!-- METHOD BREAKDOWN BAR -->
          <div class="method-breakdown-wrapper">
            <div class="method-breakdown-title">
              <span>HTTP Method Distribution</span>
              <span>${totalApiCalls} Total Calls</span>
            </div>
            <div class="method-bar">
              <div class="method-bar-seg get" style="width: ${getPct}%;" title="GET: ${getCount} (${getPct.toFixed(1)}%)"></div>
              <div class="method-bar-seg post" style="width: ${postPct}%;" title="POST: ${postCount} (${postPct.toFixed(1)}%)"></div>
              <div class="method-bar-seg patch" style="width: ${patchPct}%;" title="PATCH: ${patchCount} (${patchPct.toFixed(1)}%)"></div>
              <div class="method-bar-seg delete" style="width: ${deletePct}%;" title="DELETE: ${deleteCount} (${deletePct.toFixed(1)}%)"></div>
            </div>
            <div class="method-legend">
              <span class="legend-item"><span class="legend-dot get"></span> GET (${getCount})</span>
              <span class="legend-item"><span class="legend-dot post"></span> POST (${postCount})</span>
              <span class="legend-item"><span class="legend-dot patch"></span> PATCH (${patchCount})</span>
              <span class="legend-item"><span class="legend-dot delete"></span> DELETE (${deleteCount})</span>
            </div>
          </div>
        </div>
      </div>
    </header>

    <!-- CONTROLS -->
    <div class="controls-bar">
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input type="text" id="searchInput" class="search-input" placeholder="Search BDD Stage, Endpoint, Keyword, or Scenario..." />
      </div>
      <div class="filter-group">
        <button class="filter-btn active" data-filter="ALL">All</button>
        <button class="filter-btn" data-filter="GET">GET</button>
        <button class="filter-btn" data-filter="POST">POST</button>
        <button class="filter-btn" data-filter="PATCH">PATCH</button>
        <button class="filter-btn" data-filter="DELETE">DELETE</button>
      </div>
      <div class="filter-group">
        <button id="copyAllStoriesBtn" class="action-btn stories-btn" title="Copy all User Stories in sequential order">📝 Copy All Stories</button>
        <button id="printBtn" class="action-btn print-btn">🖨️ Export PDF</button>
      </div>
    </div>

    <!-- SPECS LIST -->
    <div id="specsContainer" class="specs-list"></div>
  </div>

  <script>
    const SPECS_DATA = ${specsJson};

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function colorizeJson(json) {
      if (json === undefined || json === null) return '<span style="color: #6B7280;">null</span>';
      const formatted = JSON.stringify(json, null, 2);
      return escapeHtml(formatted)
        .replace(/"(.*?)":/g, '<span style="color: #FBBF24;">"$1"</span>:')
        .replace(/:\s*"(.*?)"/g, ': <span style="color: #34D399;">"$1"</span>')
        .replace(/:\s*(true|false)/g, ': <span style="color: #F472B6;">$1</span>')
        .replace(/:\s*(\d+)/g, ': <span style="color: #38BDF8;">$1</span>')
        .replace(/:\s*(null)/g, ': <span style="color: #F87171;">$1</span>');
    }

    function getStatusPill(call) {
      let code = call.statusCode;
      if (!code) {
        if (call.response && call.response.success === false) {
          code = 400;
        } else {
          code = call.method === 'POST' ? 201 : 200;
        }
      }

      let text = code + ' OK';
      if (code === 201) text = '201 Created';
      else if (code === 202) text = '202 Accepted';
      else if (code === 400) text = '400 Bad Request';
      else if (code === 401) text = '401 Unauthorized';
      else if (code === 403) text = '403 Forbidden';
      else if (code === 404) text = '404 Not Found';
      else if (code === 409) text = '409 Conflict';
      else if (code === 429) text = '429 Rate Limit';

      return '<span class="status-code-pill status-' + code + '">' + text + '</span>';
    }

    function formatDocText(text, type) {
      if (!text) return '';
      let str = escapeHtml(text);

      if (type === 'story') {
        return str
          .replace(/^(As\\s+(?:an?|the)?\\s+)(.+)$/gim, '<span class="us-keyword">$1</span><span class="us-role">$2</span>')
          .replace(/^(I want to\\s+)(.+)$/gim, '<span class="us-keyword">$1</span><span class="us-action">$2</span>')
          .replace(/^(So that\\s+)(.+)$/gim, '<span class="us-keyword">$1</span><span class="us-benefit">$2</span>');
      }

      if (type === 'scenario') {
        return str
          .replace(/^(Feature:)(.+)$/gm, '<span class="gk-feature">$1</span><span class="gk-feature-title">$2</span>')
          .replace(/^(Given\\s+)(.+)$/gm, '<span class="gk-given">$1</span><span class="gk-text">$2</span>')
          .replace(/^(When\\s+)(.+)$/gm, '<span class="gk-when">$1</span><span class="gk-text">$2</span>')
          .replace(/^(Then\\s+)(.+)$/gm, '<span class="gk-then">$1</span><span class="gk-text">$2</span>')
          .replace(/^(And\\s+)(.+)$/gm, '<span class="gk-and">$1</span><span class="gk-text">$2</span>')
          .replace(/^(But\\s+)(.+)$/gm, '<span class="gk-but">$1</span><span class="gk-text">$2</span>')
          .replace(/(HTTP\\s+\\d{3}\\s+[A-Z_]+)/g, '<span class="gk-status">$1</span>')
          .replace(/\\b(GET|POST|PATCH|PUT|DELETE)\\s+([/\\w:-]+)/g, '<span class="method-pill $1">$1</span> <span class="endpoint-pill">$2</span>');
      }

      // Default: Business Rules & Specifications
      return str
        .replace(/^([•●✦]\\s*)([^:\\n]+:)/gm, '<span class="rule-bullet">✦</span> <span class="rule-cat-header">$2</span>')
        .replace(/^(\\s*[-*]\\s+)([a-zA-Z0-9_$]+)(\\s*\\([^)]+\\):?)/gm, '$1<span class="rule-param">$2</span> <span class="rule-type">$3</span>')
        .replace(/\\b(GET|POST|PATCH|PUT|DELETE)\\s+([/\\w:-]+)/g, '<span class="method-pill $1">$1</span> <span class="endpoint-pill">$2</span>')
        .replace(/\\b(true|false)\\b/g, '<span class="const-bool">$1</span>')
        .replace(/\\b(null|undefined)\\b/g, '<span class="const-null">$1</span>')
        .replace(/\\b(ACTIVE|INACTIVE|VERIFIED|UNVERIFIED|PENDING|APPROVED|REJECTED|BLOCKED|SUSPENDED|NOT_ACCEPTED)\\b/g, '<span class="rule-state $1">$1</span>')
        .replace(/(\\{[^{}]+\\})/g, '<span class="rule-inline-json">$1</span>');
    }

    function renderReport(filterMethod = 'ALL', searchQuery = '') {
      const container = document.getElementById('specsContainer');
      container.innerHTML = '';

      const query = searchQuery.trim().toLowerCase();

      const filtered = SPECS_DATA.filter(spec => {
        // Method filter
        const matchesMethod = filterMethod === 'ALL' || spec.apiCalls.some(call => call.method === filterMethod);
        if (!matchesMethod) return false;

        // Search query
        if (!query) return true;
        const inId = spec.id && spec.id.toLowerCase().includes(query);
        const inTitle = spec.title && spec.title.toLowerCase().includes(query);
        const inStory = spec.userStory && spec.userStory.toLowerCase().includes(query);
        const inRules = spec.businessRules && spec.businessRules.toLowerCase().includes(query);
        const inScenario = spec.scenario && spec.scenario.toLowerCase().includes(query);
        const inApi = spec.apiCalls.some(call => 
          (call.url && call.url.toLowerCase().includes(query)) ||
          (call.badge && String(call.badge).toLowerCase().includes(query)) ||
          (call.description && call.description.toLowerCase().includes(query))
        );

        return inId || inTitle || inStory || inRules || inScenario || inApi;
      });

      if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">No matching BDD stages found.</div>';
        return;
      }

      filtered.forEach((spec) => {
        const originalIndex = SPECS_DATA.indexOf(spec);
        const card = document.createElement('div');
        card.className = 'spec-card';
        card.id = 'spec-' + originalIndex;

        // Unique API calls (Method + Endpoint URL) in header
        const uniqueCalls = [];
        const seenCalls = new Set();
        (spec.apiCalls || []).forEach(c => {
          const key = c.method + ' ' + (c.url || '');
          if (!seenCalls.has(key)) {
            seenCalls.add(key);
            uniqueCalls.push(c);
          }
        });

        const apiPillsHtml = uniqueCalls
          .map(
            c =>
              '<span class="api-pill-group">' +
              '<span class="method-pill ' +
              c.method +
              '">' +
              c.method +
              '</span>' +
              '<span class="endpoint-pill">' +
              escapeHtml(c.url) +
              '</span>' +
              '</span>',
          )
          .join(' ');

        let bodyContent = '';

        // User Story
        if (spec.userStory) {
          bodyContent += \`
            <div class="doc-panel">
              <div class="doc-panel-header story">📝 User Story</div>
              <div class="doc-panel-content">\${formatDocText(spec.userStory, 'story')}</div>
            </div>
          \`;
        }

        // Business Rules
        if (spec.businessRules) {
          bodyContent += \`
            <div class="doc-panel">
              <div class="doc-panel-header rules">📋 Business Rules & Specifications</div>
              <div class="doc-panel-content">\${formatDocText(spec.businessRules, 'rules')}</div>
            </div>
          \`;
        }

        // Scenario
        if (spec.scenario) {
          bodyContent += \`
            <div class="doc-panel">
              <div class="doc-panel-header scenario">📖 BDD Scenario (Gherkin)</div>
              <div class="doc-panel-content">\${formatDocText(spec.scenario, 'scenario')}</div>
            </div>
          \`;
        }

        // API Calls Inspector
        if (spec.apiCalls && spec.apiCalls.length > 0) {
          bodyContent += '<div class="api-calls-container">';
          spec.apiCalls.forEach((call, callIdx) => {
            const reqId = 'req-' + originalIndex + '-' + callIdx;
            const resId = 'res-' + originalIndex + '-' + callIdx;
            const statusPillHtml = getStatusPill(call);

            bodyContent += \`
              <div class="api-call-card">
                <div class="api-call-header">
                  <div class="api-url-group">
                    <span class="method-pill \${call.method}">\${call.method}</span>
                    <span>\${escapeHtml(call.url)}</span>
                    \${call.badge ? '<span class="api-badge-tag">' + escapeHtml(call.badge) + '</span>' : ''}
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    \${statusPillHtml}
                    <span style="color: var(--text-secondary); font-size: 12px;">\${escapeHtml(call.description || '')}</span>
                  </div>
                </div>
                <div class="api-call-grid">
                  <div class="api-box">
                    <div class="api-box-title">
                      <span>Request Payload</span>
                      <button class="copy-btn" onclick="copyCode('\${reqId}')">📋 Copy</button>
                    </div>
                    <pre class="code-viewer" id="\${reqId}">\${colorizeJson(call.request)}</pre>
                  </div>
                  <div class="api-box">
                    <div class="api-box-title">
                      <span>Response Payload</span>
                      <button class="copy-btn" onclick="copyCode('\${resId}')">📋 Copy</button>
                    </div>
                    <pre class="code-viewer" id="\${resId}">\${colorizeJson(call.response)}</pre>
                  </div>
                </div>
              </div>
            \`;
          });
          bodyContent += '</div>';
        }

        card.innerHTML = \`
          <div class="spec-header" onclick="toggleCard('spec-\${originalIndex}')">
            <div class="spec-title-area">
              <div class="spec-title-row">
                <span class="stage-badge">\${escapeHtml(spec.id)}</span>
                <span class="spec-title">\${escapeHtml(spec.title)}</span>
              </div>
              \${apiPillsHtml ? '<div class="spec-endpoints-row">' + apiPillsHtml + '</div>' : ''}
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <button class="copy-card-btn" onclick="copyTest(\${originalIndex}, event)" title="Copy this test details and API payloads">📋 Copy</button>
              <span class="status-badge \${spec.status.toLowerCase()}">\${spec.status === 'PASSED' ? '✔ PASSED' : '✖ FAILED'}</span>
              <span class="expand-icon">▼</span>
            </div>
          </div>
          <div class="spec-body">
            \${bodyContent}
          </div>
        \`;

        container.appendChild(card);
      });
    }

    function toggleCard(cardId) {
      const card = document.getElementById(cardId);
      if (card) {
        card.classList.toggle('open');
      }
    }

    function formatStoryWithCommas(storyText) {
      if (!storyText) return '';
      const lines = storyText.split('\\n').map(l => l.trim()).filter(Boolean);
      return lines.map(line => {
        if (/^As\\s+/i.test(line)) {
          return line.replace(/[,;.]*$/, ',');
        }
        if (/^I want to\\s+/i.test(line)) {
          return line.replace(/[,;.]*$/, ',');
        }
        if (/^So that\\s+/i.test(line)) {
          return line.replace(/[;,]*$/, '');
        }
        return line;
      }).join('\\n');
    }

    function copyTest(index, event) {
      if (event) {
        event.stopPropagation();
      }
      const spec = SPECS_DATA[index];
      if (!spec) return;

      let md = '### [' + spec.id + '] ' + spec.title + '\\n';
      md += '- Status: ' + spec.status + '\\n';
      
      if (spec.userStory) {
        md += '\\n**📝 User Story:**\\n' + formatStoryWithCommas(spec.userStory) + '\\n';
      }
      if (spec.businessRules) {
        md += '\\n**📋 Business Rules:**\\n' + spec.businessRules + '\\n';
      }
      if (spec.scenario) {
        md += '\\n**📖 BDD Scenario:**\\n' + spec.scenario + '\\n';
      }
      if (spec.apiCalls && spec.apiCalls.length > 0) {
        md += '\\n**🌐 API Calls (' + spec.apiCalls.length + '):**\\n';
        spec.apiCalls.forEach((call, i) => {
          md += '\\n' + (i + 1) + '. [' + call.method + '] ' + (call.url || '');
          if (call.description) md += ' — ' + call.description;
          if (call.statusCode) md += ' (' + call.statusCode + ')';
          md += '\\n\\nRequest:\\n\`\`\`json\\n' + JSON.stringify(call.request, null, 2) + '\\n\`\`\`\\n';
          md += 'Response:\\n\`\`\`json\\n' + JSON.stringify(call.response, null, 2) + '\\n\`\`\`\\n';
        });
      }

      navigator.clipboard.writeText(md.trim()).then(() => {
        const btn = event && (event.currentTarget || event.target);
        if (btn) {
          const original = btn.innerHTML;
          btn.innerHTML = '✔ Copied!';
          btn.style.color = '#10B981';
          btn.style.borderColor = '#10B981';
          setTimeout(() => {
            btn.innerHTML = original;
            btn.style.color = '';
            btn.style.borderColor = '';
          }, 1500);
        }
      });
    }

    function copyCode(elementId) {
      const el = document.getElementById(elementId);
      if (!el) return;
      const text = el.innerText || el.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = el.parentElement.querySelector('.copy-btn');
        if (btn) {
          const original = btn.innerText;
          btn.innerText = '✔ Copied!';
          btn.style.color = '#10B981';
          setTimeout(() => {
            btn.innerText = original;
            btn.style.color = '';
          }, 1500);
        }
      });
    }

    // EVENT LISTENERS
    let currentFilter = 'ALL';
    let currentSearch = '';

    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter');
        renderReport(currentFilter, currentSearch);
      });
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
      currentSearch = e.target.value;
      renderReport(currentFilter, currentSearch);
    });

    document.getElementById('copyAllStoriesBtn').addEventListener('click', () => {
      const stories = [];
      const seenStories = new Set();

      SPECS_DATA.forEach((spec) => {
        if (spec.userStory && spec.userStory.trim()) {
          const formattedStory = formatStoryWithCommas(spec.userStory.trim());
          if (!seenStories.has(formattedStory)) {
            seenStories.add(formattedStory);
            stories.push({
              id: spec.id,
              title: spec.title,
              story: formattedStory,
            });
          }
        }
      });

      if (stories.length === 0) {
        alert('No User Stories found to copy.');
        return;
      }

      let text = '# 📝 Sequential User Stories (' + stories.length + ' Stories)\\n\\n';
      stories.forEach((item, index) => {
        text += '### ' + (index + 1) + '. [' + item.id + '] ' + item.title + '\\n';
        text += item.story + '\\n\\n';
        text += '---\\n\\n';
      });

      navigator.clipboard.writeText(text.trim()).then(() => {
        const btn = document.getElementById('copyAllStoriesBtn');
        if (btn) {
          const original = btn.innerHTML;
          btn.innerHTML = '✔ Copied All Stories!';
          btn.style.color = '#10B981';
          btn.style.borderColor = '#10B981';
          setTimeout(() => {
            btn.innerHTML = original;
            btn.style.color = '';
            btn.style.borderColor = '';
          }, 2000);
        }
      });
    });

    document.getElementById('printBtn').addEventListener('click', () => {
      document.querySelectorAll('.spec-card').forEach(c => c.classList.add('open'));
      setTimeout(() => {
        window.print();
      }, 200);
    });

    // INITIAL RENDER
    renderReport();
  </script>
</body>
</html>`;
  }

  public saveReport(
    outputPath: string = path.join(process.cwd(), 'reports/bdd-report.html'),
  ): string {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const html = this.generateHtml();
    fs.writeFileSync(outputPath, html, 'utf-8');
    return outputPath;
  }
}

export const bddReporter = new BddReportCollector();
