import chalk from 'chalk';
import { bddReporter } from './bddHtmlReporter';

// Force chalk to output full colors (Truecolor) even in Vitest UI / captured environments
chalk.level = 3;

type RequestData = {
  params?: any;
  query?: any;
  body?: any;
  [key: string]: any;
};

// Custom JSON syntax highlighter that bolds all tokens to make them look larger and thicker
function colorizeJson(jsonObj: any): string {
  const jsonString = JSON.stringify(jsonObj, null, 2);
  if (!jsonString) return '';

  return jsonString.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    match => {
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          // JSON Key: Yellow & Bold
          return chalk.bold.yellow(match);
        } else {
          // String value: Bright Green & Bold
          return chalk.bold.green(match);
        }
      } else if (/true|false/.test(match)) {
        // Boolean value: Magenta & Bold
        return chalk.bold.magenta(match);
      } else if (/null/.test(match)) {
        // Null value: Dim Red & Bold
        return chalk.bold.dim.red(match);
      } else {
        // Number value: Cyan & Bold
        return chalk.bold.cyan(match);
      }
    },
  );
}

export function logApi(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  requestData: RequestData,
  responseData: any,
  badge?: string | number,
  description?: string,
) {
  const methodColors = {
    GET: chalk.bgGreen.black.bold, // Green
    POST: chalk.bgYellow.black.bold, // Yellow
    PUT: chalk.bgCyan.black.bold, // Cyan
    PATCH: chalk.bgMagenta.whiteBright.bold, // Beguni / Magenta
    DELETE: chalk.bgRed.whiteBright.bold, // Red
  };

  const methodColor = methodColors[method] || chalk.bgWhite.black.bold;
  const badgeStr =
    badge !== undefined && badge !== null
      ? chalk.bold.magenta(` [${badge}]`)
      : '';
  const descStr = description ? chalk.dim.white(` - ${description}`) : '';

  // Resolve path parameters (e.g., :userId -> actual value) and query parameters (e.g. ?type=received)
  let resolvedUrl = url;
  if (requestData.params && typeof requestData.params === 'object') {
    for (const [key, value] of Object.entries(requestData.params)) {
      if (value !== undefined && value !== null) {
        resolvedUrl = resolvedUrl.replace(`:${key}`, String(value));
      }
    }
  }
  if (
    requestData.query &&
    typeof requestData.query === 'object' &&
    Object.keys(requestData.query).length > 0
  ) {
    const queryString = new URLSearchParams(requestData.query).toString();
    if (queryString) {
      resolvedUrl += `?${queryString}`;
    }
  }

  // Normalize requestData: always show params, query, body even if empty/missing
  const normalizedRequest: any = {
    params: requestData.params ?? {},
    query: requestData.query ?? {},
    body: requestData.body ?? {},
  };

  if (requestData.headers && Object.keys(requestData.headers).length > 0) {
    normalizedRequest.headers = requestData.headers;
  }

  // Infer HTTP status code
  let statusCode = requestData.statusCode;
  if (!statusCode) {
    if (responseData && responseData.success === false) {
      if (
        responseData.message?.includes('already') ||
        responseData.message?.includes('Conflict')
      ) {
        statusCode = 409;
      } else if (
        responseData.message?.includes('Unauthorized') ||
        responseData.message?.includes('token')
      ) {
        statusCode = 401;
      } else if (
        responseData.message?.includes('Forbidden') ||
        responseData.message?.includes('permission')
      ) {
        statusCode = 403;
      } else if (
        responseData.message?.includes('Not found') ||
        responseData.message?.includes('not found')
      ) {
        statusCode = 404;
      } else if (
        responseData.message?.includes('cooldown') ||
        responseData.message?.includes('Too many')
      ) {
        statusCode = 429;
      } else {
        statusCode = 400;
      }
    } else {
      if (method === 'POST') {
        if (
          description?.includes('Upload') ||
          description?.includes('upload') ||
          description?.includes('register') ||
          description?.includes('Create') ||
          description?.includes('add')
        ) {
          statusCode = 201;
        } else {
          statusCode = 200;
        }
      } else {
        statusCode = 200;
      }
    }
  }

  // Record in BDD HTML Reporter
  bddReporter.recordApiCall({
    method,
    url,
    resolvedUrl: resolvedUrl !== url ? resolvedUrl : undefined,
    request: normalizedRequest,
    response: responseData,
    statusCode,
    badge,
    description,
    timestamp: new Date().toISOString(),
  });

  // Clean, borderless, iconless, fully bold and colorful output with Postman method badges
  console.log('\n');
  console.log(
    `${methodColor(` ${method} `)}${chalk.reset('  ')}${chalk.bold.white(url)}${badgeStr}${descStr}`,
  );
  if (resolvedUrl !== url) {
    console.log(`        ${chalk.dim('↳')} ${chalk.cyan(resolvedUrl)}`);
  }

  // Format and print Request
  console.log(chalk.bgCyan.black.bold(' REQUEST ') + '\x1b[0m');
  const reqLines = colorizeJson(normalizedRequest).split('\n');
  reqLines.forEach(line => {
    // Bold the entire line to make braces/colons/brackets look thicker and bigger
    console.log(`${chalk.bold(line)}`);
  });

  // Format and print Response
  const isSuccess = responseData && responseData.success !== false;
  const responseHeader = isSuccess
    ? chalk.bgGreen.black.bold(' RESPONSE SUCCESS ') + '\x1b[0m'
    : chalk.bgRed.whiteBright.bold(' RESPONSE FAILED ') + '\x1b[0m';
  console.log(responseHeader);

  const resLines = colorizeJson(responseData).split('\n');
  resLines.forEach(line => {
    // Bold the entire line to make braces/colons/brackets look thicker and bigger
    console.log(`${chalk.bold(line)}`);
  });
  console.log('\n');
}

export function logSocket(
  type: 'EMIT' | 'RECEIVE',
  event: string,
  payload: any,
  badge?: string,
  description?: string,
) {
  const typeColors = {
    EMIT: chalk.bgBlue.whiteBright.bold, // Blue
    RECEIVE: chalk.bgGreen.black.bold, // Green
  };

  const typeColor = typeColors[type] || chalk.bgWhite.black.bold;
  const badgeStr = badge ? chalk.bold.magenta(` [${badge}]`) : '';
  const descStr = description ? chalk.dim.white(` - ${description}`) : '';

  console.log('\n');
  console.log(
    `${typeColor(` ${type} `)}${chalk.reset('  ')}${chalk.bold.white(event)}${badgeStr}${descStr}`,
  );

  console.log(chalk.bgCyan.black.bold(' PAYLOAD ') + '\x1b[0m');
  const payloadLines = colorizeJson(payload).split('\n');
  payloadLines.forEach(line => {
    console.log(`${chalk.bold(line)}`);
  });
  console.log('\n');
}

export function logBdd(
  id: string,
  title: string,
  docs?: {
    userStory?: string;
    businessRules?: string;
    scenario?: string;
  },
) {
  bddReporter.startSpec(id, title);
  if (docs) {
    bddReporter.setSpecDetails(docs);
  }
}

export function saveBddReport(outputPath?: string): string {
  return outputPath || '';
}

export { bddReporter };

