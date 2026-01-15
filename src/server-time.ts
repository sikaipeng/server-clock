// Import IANA timezone type definition (external dependency, no modification needed)
import type { IANATimezone } from './timezones.ts';

// ===================== Type Declarations =====================
/**
 * Type definition for date format string (e.g., 'YYYY-MM-DD HH:mm:ss')
*/
export type FormatString = string;

// Define request method type (restricted to GET/POST only)
export type RequestMethod = 'GET' | 'POST';

/**
 * Overload type for ServerTime.format function
 * Supports 4 calling patterns:
 * 1. No parameters (default format + system timezone)
 * 2. Only format string (custom format + system timezone)
 * 3. Only timezone (default format + specified timezone)
 * 4. Timezone + format string (custom format + specified timezone)
 */
type ServerTimeFormatFn = {
  (): string;
  (format: FormatString): string;
  (timezone: IANATimezone): string;
  (timezone: IANATimezone, format: FormatString): string;
};

/**
 * Complete type definition for ServerTime object
 * Ensures type safety and avoids implicit 'any' type
 */
interface ServerTimeType {
  /**
   * Get Date object with specified timezone
   * @param timezone Optional IANA timezone (uses system timezone if not provided)
   * @returns Date object (server time if synced, local time if failed)
   */
  getDate: (timezone?: IANATimezone) => Date;

  /**
   * Format date to string with specified format/timezone
   * Overload function (see ServerTimeFormatFn for details)
   * Supports:
   * - Padded/non-padded date/time (MM/M, DD/D, HH/H, hh/h, mm/m, ss/s)
   * - 12-hour (hh/h + A/a) and 24-hour (HH/H) formats
   */
  format: ServerTimeFormatFn;
}

/**
 * Type definition for ServerClock object (time synchronization logic)
 */
interface ServerClockType {
  /**
   * Flag indicating whether time synchronization with server succeeded
   * Read-only property, external code can only read but not modify it
   */
  readonly isSynced: boolean;

  /**
   * Synchronize time with remote server multiple times, use the lowest delay result
   * @param serverTimeApi API endpoint to fetch server timestamp (UTC milliseconds)
   * @param method Request method (default: POST)
   * @returns Promise with server timestamp (local timestamp if all fails, UTC milliseconds)
   */
  sync: (serverTimeApi: string, method?: RequestMethod) => Promise<number>;
}

// ===================== Internal Global State =====================
/**
 * Global state for time synchronization
 * - offset: Time difference between server and client (serverTime - clientMonotonicTime)
 * - isSynced: Sync status flag (true = synced with server, false = fallback to local time)
 */
interface ServerTimeState {
  offset: number;
  isSynced: boolean;
}

// Initialize sync state (offset = 0 means no time difference initially)
const state: ServerTimeState = {
  offset: 0,
  isSynced: false
};

// ===================== Internal Utility Constants & Functions =====================
/**
 * Date format handlers (immutable object)
 * Maps format tokens to timezone-aware date value getters
 */
const FORMAT_HANDLERS = {
  // Padded
  YYYY: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'year', tz, true),
  MM: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'month', tz, true),
  DD: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'day', tz, true),
  HH: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, true, false), // 24h padded
  hh: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, true, true),  // 12h padded
  mm: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'minute', tz, true),
  ss: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'second', tz, true),
  
  // non-padded
  M: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'month', tz, false),
  D: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'day', tz, false),
  H: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, false, false), // 24h non-padded
  h: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, false, true),  // 12h non-padded
  m: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'minute', tz, false),
  s: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'second', tz, false),
  
  // AM/PM
  A: (date: Date, tz?: IANATimezone) => getAmPm(date, tz, true),
  a: (date: Date, tz?: IANATimezone) => getAmPm(date, tz, false)
} as const;

// Default date format string (used when no format is specified)
const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * Auto detect timestamp unit (seconds/milliseconds) and normalize to milliseconds
 * Core logic: 
 * - 10 digits → Seconds (convert to ms by ×1000)
 * - 13 digits → Milliseconds (return directly)
 * @param timestamp Raw timestamp from server (seconds or milliseconds)
 * @returns Normalized timestamp in milliseconds
 */
const normalizeTimestamp = (timestamp: number): number => {
  const intTimestamp = Math.round(timestamp);
  const timestampStr = Math.abs(intTimestamp).toString();
  const length = timestampStr.length;

  if (length === 10) return timestamp * 1000;
  return intTimestamp;
};

/**
 * Get current timestamp with sync fallback logic
 * Use performance.now() as monotonic time source, not affected by system time changes
 * @returns Server timestamp (UTC milliseconds) if synced, local timestamp if failed
 */
const getServerTimestamp = (): number => {
  // Return system time directly if not synced
  if (!state.isSynced) return Date.now();

  return performance.now() + state.offset;
};

/**
 * Get timezone-aware date part from UTC timestamp
 * @param date UTC-based Date object (required)
 * @param part Date part to retrieve (year/month/day/hour/minute/second)
 * @param tz Optional IANA timezone (system timezone if not provided)
 * @param pad Optional: Add leading zero (true = padded, false = non-padded)
 * @param use12Hour Optional: Use 12-hour format (only applies to 'hour' part)
 * @returns Formatted string for the target timezone
 */
const getTimezoneDatePart = (
  date: Date,
  part: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
  tz?: IANATimezone,
  pad: boolean = true,
  use12Hour: boolean = false
): string => {
  // Use system timezone if not specified
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

  const baseOptions: Intl.DateTimeFormatOptions = {
    timeZone,
    hour12: use12Hour
  };

  // Add part-specific options (type-safe for each part)
  const options: Intl.DateTimeFormatOptions = {
    ...baseOptions,
    // For year: always use 'numeric' (4-digit)
    ...(part === 'year' && { year: 'numeric' }),
    // For other parts: use '2-digit' for padded, 'numeric' for non-padded
    ...(part === 'month' && { month: pad ? '2-digit' : 'numeric' }),
    ...(part === 'day' && { day: pad ? '2-digit' : 'numeric' }),
    ...(part === 'hour' && { hour: pad ? '2-digit' : 'numeric' }),
    ...(part === 'minute' && { minute: pad ? '2-digit' : 'numeric' }),
    ...(part === 'second' && { second: pad ? '2-digit' : 'numeric' })
  };

  // Get raw part value from Intl API (timezone-aware)
  let partValue = new Intl.DateTimeFormat('en-US', options)
    .formatToParts(date)
    .find(p => p.type === part)?.value || '';

  return partValue;
};

/**
 * Get AM/PM indicator for 12-hour format (timezone-aware)
 * @param date UTC-based Date object
 * @param tz Optional IANA timezone
 * @param uppercase Optional: Return uppercase (AM/PM) or lowercase (am/pm)
 * @returns AM/PM string (e.g., "AM", "pm")
 */
const getAmPm = (
  date: Date,
  tz?: IANATimezone,
  uppercase: boolean = true
): string => {
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  // Extract dayPeriod (am/pm) from Intl API
  const amPmValue = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: true,
    hour: '2-digit'
  })
    .formatToParts(date)
    .find(p => p.type === 'dayPeriod')?.value || '';

  // Return uppercase/lowercase as requested
  return uppercase ? amPmValue.toUpperCase() : amPmValue.toLowerCase();
};

/**
 * Format Date object to specified string format with timezone support
 * @param date UTC-based Date object
 * @param fmt Target format string
 * @param tz Optional IANA timezone
 * @returns Timezone-aware formatted date string
 */
const formatDate = (date: Date, fmt: FormatString, tz?: IANATimezone): string => {
  return Object.entries(FORMAT_HANDLERS).reduce((result, [token, handler]) => {
    return result.replace(token, handler(date, tz));
  }, fmt);
};

/**
 * Validate if a string is a valid IANA timezone
 * @param v String to validate
 * @returns Boolean indicating if the string is a valid IANA timezone
 */
const isValidTimezone = (v: string): v is IANATimezone => {
  const validTimezonePrefixes = [
    'Africa/', 'America/', 'Antarctica/', 'Arctic/', 'Asia/',
    'Atlantic/', 'Australia/', 'Europe/', 'Indian/', 'Pacific/'
  ];
  const basicValidTimezones = ['UTC', 'GMT', 'Zulu'];

  return validTimezonePrefixes.some(prefix => v.startsWith(prefix))
    || basicValidTimezones.includes(v);
};

/**
 * Single sync attempt (internal use)
 * Implements simplified NTP algorithm to calculate time offset and network delay
 * @param serverTimeApi API endpoint
 * @param method Request method
 * @returns Object with offset, delay, serverTimestamp (or null if failed)
 */
const singleSyncAttempt = async (serverTimeApi: string, method: RequestMethod): Promise<{
  offset: number;
  delay: number;
  serverTimestamp: number;
} | null> => {
  try {
    // NTP Step 1: Record client send time (monotonic time to avoid system time changes)
    const t1 = performance.now();

    // Set 5s timeout for request to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const fetchOptions: RequestInit = {
      method: method,
      signal: controller.signal,
      ...(method === 'POST' && {
        headers: {
          'Content-Type': 'application/json'
        }
      })
    };

    const response = await fetch(serverTimeApi, fetchOptions);
    clearTimeout(timeoutId); // Clear timeout if request succeeds
    if (!response.ok) {
      throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
    }

    const responseData = await response.json();
    if (!responseData || typeof responseData !== 'object' || !('timestamp' in responseData)) {
      throw new Error('Invalid response format: missing timestamp field');
    }

    const rawServerTimestamp = Number(responseData.timestamp);
    if (isNaN(rawServerTimestamp) || !Number.isFinite(rawServerTimestamp)) {
      throw new Error('Timestamp is not a valid number');
    }
    const serverTimestamp = normalizeTimestamp(rawServerTimestamp);

    // NTP Step 2: Simulate server receive/send time (simplified for browser environment)
    const t2 = serverTimestamp - 100; // Server receive time (approx)
    const t3 = serverTimestamp + 100; // Server send time (approx)
    const t4 = performance.now();     // Client receive time (monotonic)

    // NTP Step 3: Calculate time offset and network delay
    // Offset = ((t2 - t1) + (t3 - t4)) / 2 → Time difference between server and client
    // Delay = (t4 - t1) - (t3 - t2) → Actual network round-trip delay
    const offset = ((t2 - t1) + (t3 - t4)) / 2;
    const delay = (t4 - t1) - (t3 - t2);

    return { offset, delay, serverTimestamp };
  } catch (error) {
    // Return null on failure (will be handled in sync loop)
    return null;
  }
};

/**
 * Precision delay function without blocking
 * Uses requestAnimationFrame for browser (higher precision) or setTimeout for Node.js
 * @param ms Delay in milliseconds
 */
async function preciseDelay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const start = performance.now();

    // Unified timer handler compatible with browser/Node.js
    const scheduleNextCheck = (callback: (timestamp: number) => void) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        return requestAnimationFrame(callback);
      } else {
        // Adapt setTimeout to match FrameRequestCallback signature (accept timestamp parameter)
        return setTimeout(() => callback(performance.now()), 0) as unknown as number;
      }
    };

    // Check function matches FrameRequestCallback signature (with timestamp parameter)
    const check: FrameRequestCallback = (timestamp: number) => {
      const elapsed = performance.now() - start;
      if (elapsed >= ms) {
        resolve();
        return;
      }
      // Schedule next check if delay not reached
      scheduleNextCheck(check);
    };

    scheduleNextCheck(check);
  });
}

// ===================== Core Exports =====================
/**
 * ServerClock - Core time synchronization logic
 * Implements multiple sync attempts and selects the result with lowest network delay
 */
export const ServerClock: ServerClockType = {
  // Read-only sync status (mapped to internal state)
  get isSynced() {
    return state.isSynced;
  },

  /**
   * Main sync method (multiple attempts with lowest delay selection)
   * @param serverTimeApi API endpoint to fetch server timestamp
   * @param method Request method (default: POST)
   * @returns Promise with server timestamp (local time if all attempts fail)
   */
  sync: async (
    serverTimeApi: string,
    method: RequestMethod = 'POST'
  ): Promise<number> => {
    // Hardcoded default parameters (3 attempts, 100ms interval)
    const times: number = 3;
    const intervalMs: number = 100;
    const validTimes = Math.max(1, Math.round(times)); // At least 1 attempt
    const validInterval = Math.max(50, Math.round(intervalMs)); // Min 50ms to avoid request congestion

    // Reset sync state before new sync attempts
    state.isSynced = false;
    state.offset = 0;

    // Store successful sync results (filter out failed attempts)
    const syncResults: Array<{
      offset: number;
      delay: number;
      serverTimestamp: number;
    }> = [];

    // Execute multiple sync attempts with interval between them
    for (let i = 0; i < validTimes; i++) {
      // Add interval between attempts (skip first attempt)
      if (i > 0) {
        await preciseDelay(validInterval);
      }

      // Execute single sync attempt and collect valid results
      const result = await singleSyncAttempt(serverTimeApi, method);
      if (result) {
        syncResults.push(result);
      }
    }

    // Fallback to local time if all attempts fail
    if (syncResults.length === 0) {
      return Date.now();
    }

    // Select result with lowest network delay (most accurate per NTP best practice)
    const lowestDelayResult = syncResults.reduce((prev, current) => {
      return current.delay < prev.delay ? current : prev;
    });

    // Update global state with the most accurate offset
    state.offset = lowestDelayResult.offset;
    state.isSynced = true;

    // Return server timestamp from the most accurate attempt
    return lowestDelayResult.serverTimestamp;
  }
};

/**
 * Get timezone-aware Date object (returns UTC Date with correct timezone context)
 * @param timezone Optional IANA timezone
 * @returns Date object (UTC timestamp with timezone metadata)
 */
const getDateFunction = (timezone?: IANATimezone): Date => {
  const utcTimestamp = getServerTimestamp();
  return new Date(utcTimestamp);
};

/**
 * Format function implementation with overload support (timezone-aware)
 * Handles all 4 calling patterns defined in ServerTimeFormatFn
 */
const formatFunction: ServerTimeFormatFn = function (
  arg1?: IANATimezone | FormatString,
  arg2?: FormatString
): string {
  let targetTimezone: IANATimezone | undefined;
  let targetFormat: FormatString = DEFAULT_FORMAT;

  if (arg1 === undefined) {
    // Pattern 1: No parameters (default format + system timezone)
    targetTimezone = undefined;
  } else if (arg2 === undefined) {
    // Pattern 2 or 3: Single parameter (format string or timezone)
    targetTimezone = isValidTimezone(arg1) ? (arg1 as IANATimezone) : undefined;
    targetFormat = targetTimezone ? DEFAULT_FORMAT : (arg1 as FormatString);
  } else {
    // Pattern 4: Two parameters (timezone + format string)
    targetTimezone = arg1 as IANATimezone;
    targetFormat = arg2;
  }

  // Get UTC timestamp and format with target timezone
  const utcDate = new Date(getServerTimestamp());
  return formatDate(utcDate, targetFormat, targetTimezone);
};

/**
 * ServerTime - Core time formatting and timezone conversion logic
 * Provides getDate (Date object) and format (formatted string) methods
*/
export const ServerTime: ServerTimeType = {
  getDate: getDateFunction,
  format: formatFunction
};

// ===================== Default Export =====================
export default {
  ServerClock,
  ServerTime
} as {
  ServerClock: ServerClockType;
  ServerTime: ServerTimeType;
};