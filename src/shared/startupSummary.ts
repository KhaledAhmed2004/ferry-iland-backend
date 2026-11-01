import colors from 'colors';

/**
 * Startup Summary Generator
 *
 * Generates beautiful formatted startup summary boxes for application initialization.
 * Mirrors the visual style of the banner system for consistency.
 *
 * Features:
 * - Multiple display styles (compact, progress, minimal)
 * - Status tracking with success/error icons
 * - Color support (environment-aware)
 * - Consistent box-drawing with banner
 * - Automatic timestamp formatting
 */

export type StartupStatus = {
  environment: string;
  debugMode: boolean;
  database: {
    status: 'connected' | 'disconnected' | 'error';
    message?: string;
  };
  cache: {
    status: 'initialized' | 'disabled' | 'error';
    message?: string;
  };
  rateLimit: boolean;
  socketIO: boolean;
  server: {
    url: string;
    host: string;
    port: number;
  };
  timestamp?: string;
};

export type SummaryStyle = 'compact' | 'progress' | 'minimal';

export type BannerStyle = 'single' | 'double' | 'bold' | 'rounded';

export type SummaryOptions = {
  style?: SummaryStyle;
  borderStyle?: BannerStyle;
  width?: number;
  colors?: boolean;
};

// Border character sets (same as bannerGenerator.ts)
const BORDER_STYLES = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    dividerLeft: '├',
    dividerRight: '┤',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    dividerLeft: '╠',
    dividerRight: '╣',
  },
  bold: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
    dividerLeft: '┣',
    dividerRight: '┫',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    dividerLeft: '├',
    dividerRight: '┤',
  },
};

// Status icons
const STATUS_ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  pending: '⏳',
};

// Environment emojis
const ENV_EMOJIS = {
  production: '🚀',
  development: '🛠️',
  staging: '🎭',
  test: '🧪',
  default: '⚙️',
};

/**
 * Apply color to text safely
 */
function applyColor(
  text: string,
  colorName?: keyof typeof colors,
  enableColors: boolean = true
): string {
  if (!enableColors || !colorName) return text;

  try {
    const colorFn = colors[colorName];
    if (typeof colorFn === 'function') {
      const result = colorFn(text);
      return typeof result === 'string' ? result : text;
    }
  } catch {
    // If color fails, return plain text
  }

  return text;
}

/**
 * Strip ANSI color codes from text
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Get display length (excluding ANSI codes)
 */
function getDisplayLength(text: string): number {
  return stripAnsi(text).length;
}

/**
 * Build top border line
 */
function buildTopBorder(
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const line =
    borders.topLeft + borders.horizontal.repeat(width - 2) + borders.topRight;
  return applyColor(line, borderColor, enableColors);
}

/**
 * Build bottom border line
 */
function buildBottomBorder(
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const line =
    borders.bottomLeft +
    borders.horizontal.repeat(width - 2) +
    borders.bottomRight;
  return applyColor(line, borderColor, enableColors);
}

/**
 * Build divider line
 */
function buildDivider(
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const line =
    borders.dividerLeft +
    borders.horizontal.repeat(width - 2) +
    borders.dividerRight;
  return applyColor(line, borderColor, enableColors);
}

/**
 * Build empty line
 */
function buildEmptyLine(
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const contentWidth = width - 4; // 2 for borders, 2 for padding
  const leftBorder = applyColor(borders.vertical, borderColor, enableColors);
  const rightBorder = applyColor(borders.vertical, borderColor, enableColors);
  return leftBorder + ' ' + ' '.repeat(contentWidth) + ' ' + rightBorder;
}

/**
 * Build content line (centered)
 */
function buildContentLine(
  content: string,
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const contentWidth = width - 4;
  const displayLength = getDisplayLength(content);

  let paddedContent: string;
  if (displayLength >= contentWidth) {
    paddedContent = content;
  } else {
    const leftPadding = Math.floor((contentWidth - displayLength) / 2);
    const rightPadding = contentWidth - displayLength - leftPadding;
    paddedContent =
      ' '.repeat(leftPadding) + content + ' '.repeat(rightPadding);
  }

  const leftBorder = applyColor(borders.vertical, borderColor, enableColors);
  const rightBorder = applyColor(borders.vertical, borderColor, enableColors);
  return leftBorder + ' ' + paddedContent + ' ' + rightBorder;
}

/**
 * Build info line (label-value pair)
 */
function buildInfoLine(
  label: string,
  value: string,
  width: number,
  borders: typeof BORDER_STYLES.double,
  borderColor?: keyof typeof colors,
  labelColor?: keyof typeof colors,
  valueColor?: keyof typeof colors,
  enableColors: boolean = true
): string {
  const contentWidth = width - 4;

  const coloredLabel = applyColor(label, labelColor, enableColors);
  const coloredValue = applyColor(value, valueColor, enableColors);

  const labelLength = getDisplayLength(coloredLabel);
  const valueLength = getDisplayLength(coloredValue);
  const spacing = Math.max(1, contentWidth - labelLength - valueLength);

  const content = coloredLabel + ' '.repeat(spacing) + coloredValue;
  const displayLength = getDisplayLength(content);
  const padding = ' '.repeat(Math.max(0, contentWidth - displayLength));

  const leftBorder = applyColor(borders.vertical, borderColor, enableColors);
  const rightBorder = applyColor(borders.vertical, borderColor, enableColors);
  return leftBorder + ' ' + content + padding + ' ' + rightBorder;
}

/**
 * Get environment emoji
 */
function getEnvironmentEmoji(environment: string): string {
  const env = environment.toLowerCase();
  if (env.includes('prod')) return ENV_EMOJIS.production;
  if (env.includes('dev')) return ENV_EMOJIS.development;
  if (env.includes('test')) return ENV_EMOJIS.test;
  if (env.includes('staging')) return ENV_EMOJIS.staging;
  return ENV_EMOJIS.default;
}

/**
 * Get border color based on environment
 */
function getBorderColor(environment: string): keyof typeof colors {
  const env = environment.toLowerCase();
  if (env.includes('prod')) return 'cyan';
  if (env.includes('dev')) return 'green';
  if (env.includes('staging')) return 'yellow';
  if (env.includes('test')) return 'magenta';
  return 'white';
}

/**
 * Generate compact startup summary (Option 1)
 */
export function generateCompactSummary(
  status: StartupStatus,
  options?: SummaryOptions
): string {
  const borderStyle = options?.borderStyle || 'double';
  const width = options?.width || 63;
  const enableColors = options?.colors !== false;

  const borders = BORDER_STYLES[borderStyle];
  const borderColor = getBorderColor(status.environment);
  const lines: string[] = [];

  // Top border
  lines.push(buildTopBorder(width, borders, borderColor, enableColors));

  // Title
  const title = applyColor(
    'STARTUP STATUS',
    borderColor,
    enableColors
  );
  lines.push(buildContentLine(title, width, borders, borderColor, enableColors));

  // Divider
  lines.push(buildDivider(width, borders, borderColor, enableColors));

  // Environment
  const envEmoji = getEnvironmentEmoji(status.environment);
  lines.push(
    buildInfoLine(
      'Environment',
      `${status.environment.toUpperCase()} ${envEmoji}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Debug Mode
  const debugStatus = status.debugMode
    ? `ENABLED ${STATUS_ICONS.success}`
    : `DISABLED`;
  lines.push(
    buildInfoLine(
      'Debug Mode',
      debugStatus,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Database
  const dbStatus =
    status.database.status === 'connected'
      ? `CONNECTED ${STATUS_ICONS.success}`
      : status.database.status === 'error'
      ? `ERROR ${STATUS_ICONS.error}`
      : `DISCONNECTED ${STATUS_ICONS.warning}`;
  lines.push(
    buildInfoLine(
      'Database',
      dbStatus,
      width,
      borders,
      borderColor,
      'white',
      status.database.status === 'connected' ? borderColor : 'red',
      enableColors
    )
  );

  // Cache
  const cacheStatus =
    status.cache.status === 'initialized'
      ? `INITIALIZED ${STATUS_ICONS.success}`
      : status.cache.status === 'error'
      ? `ERROR ${STATUS_ICONS.error}`
      : `DISABLED ${STATUS_ICONS.warning}`;
  lines.push(
    buildInfoLine(
      'Cache',
      cacheStatus,
      width,
      borders,
      borderColor,
      'white',
      status.cache.status === 'initialized' ? borderColor : 'red',
      enableColors
    )
  );

  // Rate Limit
  const rateLimitStatus = status.rateLimit
    ? `ACTIVE ${STATUS_ICONS.success}`
    : `DISABLED`;
  lines.push(
    buildInfoLine(
      'Rate Limit',
      rateLimitStatus,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Socket.IO
  const socketStatus = status.socketIO
    ? `READY ${STATUS_ICONS.success}`
    : `DISABLED`;
  lines.push(
    buildInfoLine(
      'Socket.IO',
      socketStatus,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Server URL
  lines.push(
    buildInfoLine(
      'Server URL',
      status.server.url,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Divider
  lines.push(buildDivider(width, borders, borderColor, enableColors));

  // Timestamp
  if (status.timestamp) {
    lines.push(
      buildInfoLine(
        'Started',
        status.timestamp,
        width,
        borders,
        borderColor,
        'white',
        'gray',
        enableColors
      )
    );
  }

  // Bottom border
  lines.push(buildBottomBorder(width, borders, borderColor, enableColors));

  return lines.join('\n');
}

/**
 * Generate progress-style startup summary (Option 2)
 */
export function generateProgressSummary(
  status: StartupStatus,
  options?: SummaryOptions
): string {
  const borderStyle = options?.borderStyle || 'double';
  const width = options?.width || 63;
  const enableColors = options?.colors !== false;

  const borders = BORDER_STYLES[borderStyle];
  const borderColor = getBorderColor(status.environment);
  const lines: string[] = [];

  // Top border
  lines.push(buildTopBorder(width, borders, borderColor, enableColors));

  // Title
  const title = applyColor(
    '🚀 STARTUP SEQUENCE COMPLETE',
    borderColor,
    enableColors
  );
  lines.push(buildContentLine(title, width, borders, borderColor, enableColors));

  // Divider
  lines.push(buildDivider(width, borders, borderColor, enableColors));

  // Empty line
  lines.push(buildEmptyLine(width, borders, borderColor, enableColors));

  // Progress items
  const items = [
    {
      label: 'Environment Configuration',
      value: status.environment.toUpperCase(),
      success: true,
    },
    {
      label: 'Database Connection',
      value:
        status.database.status === 'connected' ? 'MongoDB Ready' : 'Failed',
      success: status.database.status === 'connected',
    },
    {
      label: 'Cache System',
      value:
        status.cache.status === 'initialized' ? 'In-Memory Active' : 'Disabled',
      success: status.cache.status === 'initialized',
    },
    {
      label: 'Security Middleware',
      value: status.rateLimit ? 'Rate Limit Enabled' : 'Disabled',
      success: status.rateLimit,
    },
    {
      label: 'WebSocket Server',
      value: status.socketIO ? 'Socket.IO Ready' : 'Disabled',
      success: status.socketIO,
    },
    {
      label: 'HTTP Server',
      value: `Listening on :${status.server.port}`,
      success: true,
    },
  ];

  for (const item of items) {
    const icon = item.success ? STATUS_ICONS.success : STATUS_ICONS.error;
    const content = `  [${icon}] ${item.label}  → ${item.value}`;
    const leftBorder = applyColor(borders.vertical, borderColor, enableColors);
    const rightBorder = applyColor(borders.vertical, borderColor, enableColors);
    const contentWidth = width - 4;
    const paddedContent = content + ' '.repeat(Math.max(0, contentWidth - getDisplayLength(content)));
    lines.push(leftBorder + ' ' + paddedContent + ' ' + rightBorder);
  }

  // Empty line
  lines.push(buildEmptyLine(width, borders, borderColor, enableColors));

  // Divider
  lines.push(buildDivider(width, borders, borderColor, enableColors));

  // Server ready message
  const readyMsg = `Server ready at ${status.server.url} 🎉`;
  lines.push(buildContentLine(readyMsg, width, borders, borderColor, enableColors));

  // Timestamp
  if (status.timestamp) {
    const timeMsg = `Started ${status.timestamp} (Asia/Dhaka)`;
    lines.push(buildContentLine(timeMsg, width, borders, borderColor, enableColors));
  }

  // Bottom border
  lines.push(buildBottomBorder(width, borders, borderColor, enableColors));

  return lines.join('\n');
}

/**
 * Generate minimal startup summary (Option 3)
 */
export function generateMinimalSummary(
  status: StartupStatus,
  options?: SummaryOptions
): string {
  const borderStyle = options?.borderStyle || 'double';
  const width = options?.width || 63;
  const enableColors = options?.colors !== false;

  const borders = BORDER_STYLES[borderStyle];
  const borderColor = getBorderColor(status.environment);
  const lines: string[] = [];

  // Top border
  lines.push(buildTopBorder(width, borders, borderColor, enableColors));

  // Environment
  const envEmoji = getEnvironmentEmoji(status.environment);
  lines.push(
    buildInfoLine(
      'Environment',
      `${status.environment.toUpperCase()} ${envEmoji}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Database
  const dbIcon =
    status.database.status === 'connected'
      ? STATUS_ICONS.success
      : STATUS_ICONS.error;
  lines.push(
    buildInfoLine(
      'Database',
      `Connected ${dbIcon}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Cache
  const cacheIcon =
    status.cache.status === 'initialized'
      ? STATUS_ICONS.success
      : STATUS_ICONS.warning;
  lines.push(
    buildInfoLine(
      'Cache',
      `Initialized ${cacheIcon}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Rate Limiting
  lines.push(
    buildInfoLine(
      'Rate Limiting',
      `Active ${STATUS_ICONS.success}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // WebSocket
  lines.push(
    buildInfoLine(
      'WebSocket',
      `Ready ${STATUS_ICONS.success}`,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Server
  lines.push(
    buildInfoLine(
      'Server',
      status.server.url,
      width,
      borders,
      borderColor,
      'white',
      borderColor,
      enableColors
    )
  );

  // Empty line
  lines.push(buildEmptyLine(width, borders, borderColor, enableColors));

  // Timestamp
  if (status.timestamp) {
    const timeMsg = `System ready at ${status.timestamp}`;
    lines.push(
      buildContentLine(timeMsg, width, borders, borderColor, enableColors)
    );
  }

  // Bottom border
  lines.push(buildBottomBorder(width, borders, borderColor, enableColors));

  return lines.join('\n');
}

/**
 * Generate startup summary (main function)
 */
export function generateStartupSummary(
  status: StartupStatus,
  options?: SummaryOptions
): string {
  const style = options?.style || 'compact';

  switch (style) {
    case 'compact':
      return generateCompactSummary(status, options);
    case 'progress':
      return generateProgressSummary(status, options);
    case 'minimal':
      return generateMinimalSummary(status, options);
    default:
      return generateCompactSummary(status, options);
  }
}
