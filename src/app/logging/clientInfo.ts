import { Request, Response, NextFunction } from 'express';
import { UAParser } from 'ua-parser-js';

// Normalize header value to a clean string (strip quotes from CH headers)
const asToken = (v: unknown): string | undefined => {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  // Client Hints often come as quoted strings, e.g. "Windows"
  return s.replace(/^"|"$/g, '');
};

// Map Windows Client Hint platformVersion tokens to friendly marketing names.
// Chrome provides numeric tokens (e.g., 19.0.0) that do not equal "Windows 11".
// Heuristic: major >= 13 => Windows 11, else Windows 10.
const windowsLabelFromPlatformVersion = (v?: string): string | undefined => {
  if (!v) return undefined;
  const major = parseInt(String(v).split('.')[0], 10);
  if (!Number.isFinite(major)) return undefined;
  return major >= 13 ? 'Windows 11' : 'Windows 10';
};

export const clientInfo = (req: Request, res: Response, next: NextFunction) => {
  const ua = String(req.headers['user-agent'] || '');
  const chUa = req.headers['sec-ch-ua'];
  const chPlatform = req.headers['sec-ch-ua-platform'];
  const chPlatformVersion = req.headers['sec-ch-ua-platform-version'];
  const chMobile = req.headers['sec-ch-ua-mobile'];
  const chModel = req.headers['sec-ch-ua-model'];
  const chArch = req.headers['sec-ch-ua-arch'];
  const chBitness = req.headers['sec-ch-ua-bitness'];

  const parsed = new UAParser(ua).getResult();

  const os = asToken(chPlatform) || parsed.os.name || 'Unknown';
  const osVersion = asToken(chPlatformVersion) || parsed.os.version || undefined;
  const deviceModel = asToken(chModel) || parsed.device.model || undefined;
  const osFriendly = os === 'Windows' ? windowsLabelFromPlatformVersion(osVersion) || 'Windows' : os;

  // sec-ch-ua-mobile: '?1' (true) or '?0' (false)
  const mobileFlag = typeof chMobile === 'string' ? chMobile : undefined;
  const deviceType = mobileFlag === '?1' ? 'mobile' : mobileFlag === '?0' ? 'desktop' : parsed.device.type || 'desktop';

  const browser = parsed.browser.name || undefined;
  const browserVersion = parsed.browser.version || undefined;

  (res.locals as any).clientInfo = {
    os,
    osFriendly,
    osVersion,
    deviceType,
    deviceModel,
    arch: asToken(chArch),
    bitness: asToken(chBitness),
    browser,
    browserVersion,
    ua,
    chUa: typeof chUa === 'string' ? chUa : undefined,
  };

  next();
};
