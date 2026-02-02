// Import IANA timezone type definition (external dependency, no modification needed)
import type { IANATimezone } from './timezones.ts';

// ===================== Constants Definition =====================
// Core configuration constants for time synchronization
const CONSTANTS = {
  REQUEST_TIMEOUT_MS: 5000,          // Timeout for each sync request (5 seconds)
  DEFAULT_SYNC_ATTEMPTS: 3,          // Default number of sync attempts for better accuracy
  DEFAULT_SYNC_INTERVAL_MS: 100,     // Interval between sync attempts (100ms)
  MIN_SYNC_INTERVAL_MS: 50,          // Minimum interval to avoid request congestion
  DEFAULT_AUTO_UPDATE_INTERVAL_MS: 300000, // Auto sync interval (5 minutes in ms)
};

// ===================== Type Declarations =====================
export type FormatString = string;
export type RequestMethod = 'GET' | 'POST';

// Overload type for date formatting function (supports multiple parameter combinations)
type ServerTimeFormatFn = {
  (): string;
  (format: FormatString): string;
  (timezone: IANATimezone): string;
  (timezone: IANATimezone, format: FormatString): string;
};

/**
 * Promise type with autoUpdate method
 * Extends native Promise<number> to support auto-sync functionality
 */
interface SyncPromise extends Promise<number> {
  /**
   * Set auto update for time synchronization
   * @param intervalMs Auto update interval in milliseconds (default: 300000ms/5min), disable when ≤0
   * @returns SyncPromise
   */
  autoUpdate: (intervalMs?: number) => SyncPromise;
}

interface ServerTimeType {
  getDate: (timezone?: IANATimezone) => Date; // Get synced date object with optional timezone
  format: ServerTimeFormatFn;                 // Format synced time with custom patterns
}

interface ServerClockType {
  readonly isSynced: boolean;                          // Flag indicating if time sync succeeded
  sync: (serverTimeApi: string, method?: RequestMethod) => SyncPromise; // Core sync method
}

// ===================== Internal Global State =====================
// Global state management for time synchronization (persists across sync attempts)
interface ServerTimeState {
  offset: number;                          // Calculated time offset between client and server
  isSynced: boolean;                       // Sync status flag
  autoUpdateTimer: number | null;          // Auto sync interval timer reference
}

// Initialize global state with default values
const state: ServerTimeState = {
  offset: 0,
  isSynced: false,
  autoUpdateTimer: null,
};

// ===================== Formatter Cache =====================
// Cache for Intl.DateTimeFormat instances to avoid expensive re-creation
// Key: JSON string of locale + options, Value: Reusable formatter instance
const formatterCache = new Map<string, Intl.DateTimeFormat>();

// ===================== Internal Utility Constants & Functions =====================
// Date format token handlers (maps tokens like YYYY, MM to actual date parts)
const FORMAT_HANDLERS = {
  YYYY: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'year', tz, true),
  MM: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'month', tz, true),
  DD: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'day', tz, true),
  HH: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, true, false), // 24h format
  hh: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, true, true),  // 12h format
  mm: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'minute', tz, true),
  ss: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'second', tz, true),
  M: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'month', tz, false),  // No padding
  D: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'day', tz, false),    // No padding
  H: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, false, false),
  h: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz, false, true),
  m: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'minute', tz, false),
  s: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'second', tz, false),
  A: (date: Date, tz?: IANATimezone) => getAmPm(date, tz, true),  // AM/PM uppercase
  a: (date: Date, tz?: IANATimezone) => getAmPm(date, tz, false)  // am/pm lowercase
} as const;

const DEFAULT_FORMAT = 'YYYY-MM-DD HH:mm:ss'; // Default date format pattern

/**
 * Normalize timestamp to milliseconds (handles 10-digit second timestamps)
 * @param timestamp Raw timestamp (could be in seconds or milliseconds)
 * @returns Normalized timestamp in milliseconds
 * @throws Error if timestamp is invalid (non-number, NaN, infinite)
 */
const normalizeTimestamp = (timestamp: unknown): number => {
  if (typeof timestamp !== 'number' || isNaN(timestamp) || !Number.isFinite(timestamp)) {
    throw new Error('Invalid timestamp: must be a finite number');
  }
  const intTimestamp = Math.round(timestamp);
  const timestampStr = Math.abs(intTimestamp).toString();
  // Convert 10-digit second timestamps to 13-digit millisecond timestamps
  return timestampStr.length === 10 ? intTimestamp * 1000 : intTimestamp;
};

/**
 * Get current synced timestamp (server time if synced, fallback to last valid/local time)
 * Uses performance.now() + offset for monotonic time (avoids system time changes)
 * @returns Current synced timestamp in milliseconds
 */
const getServerTimestamp = (): number => {
  if (!state.isSynced) {
    // Fallback to last valid server time or local time if sync failed
    return Date.now();
  }
  // Calculate current server time using monotonic clock + offset
  return performance.now() + state.offset;
};

/**
 * Get specific date part (year/month/day etc.) with timezone support
 * @param date Date object to format
 * @param part Date part to extract (year/month/day/hour/minute/second)
 * @param tz Optional timezone (defaults to system timezone)
 * @param pad Whether to pad with leading zero (e.g., 01 instead of 1)
 * @param use12Hour Whether to use 12-hour format for hours
 * @returns Formatted date part string
 */
const getTimezoneDatePart = (
  date: Date,
  part: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
  tz?: IANATimezone,
  pad: boolean = true,
  use12Hour: boolean = false
): string => {
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const baseOptions: Intl.DateTimeFormatOptions = { timeZone, hour12: use12Hour };

  // Build format options based on requested date part
  const options: Intl.DateTimeFormatOptions = {
    ...baseOptions,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  };

  // Use cached formatter or create new one
  const cacheKey = JSON.stringify({ locale: 'en-US', options });
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', options);
    formatterCache.set(cacheKey, formatter);
  }

  // Extract and return the requested date part
  const value = formatter
    .formatToParts(date)
    .find(p => p.type === part)?.value || '';

  return pad ? value : String(Number(value));
};

/**
 * Get AM/PM indicator with timezone support
 * @param date Date object to format
 * @param tz Optional timezone
 * @param uppercase Whether to return uppercase (AM/PM) or lowercase (am/pm)
 * @returns AM/PM string (or empty string if not found)
 */
const getAmPm = (
  date: Date,
  tz?: IANATimezone,
  uppercase: boolean = true
): string => {
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    hour12: true,
    hour: '2-digit'
  };
  
  const cacheKey = JSON.stringify({ locale: 'en-US', options });
  let formatter = formatterCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', options);
    formatterCache.set(cacheKey, formatter);
  }

  const amPmValue = formatter
    .formatToParts(date)
    .find(p => p.type === 'dayPeriod')?.value || '';
  return uppercase ? amPmValue.toUpperCase() : amPmValue.toLowerCase();
};

/**
 * Format date using custom pattern (supports timezone)
 * Uses split/join instead of replaceAll for ES5 compatibility
 * @param date Date object to format
 * @param fmt Custom format pattern (e.g., YYYY-MM-DD HH:mm:ss)
 * @param tz Optional timezone
 * @returns Formatted date string
 */
const formatDate = (date: Date, fmt: FormatString, tz?: IANATimezone): string => {
  let result = fmt;
  // Replace each format token with actual date part
  Object.entries(FORMAT_HANDLERS).forEach(([token, handler]) => {
    result = result.split(token).join(handler(date, tz));
  });
  return result;
};

/**
 * Validate if a string is a valid IANA timezone
 * @param v String to validate
 * @returns True if valid IANA timezone, false otherwise (type guard)
 */
const isValidTimezone = (v: string): v is IANATimezone => {
  const validPrefixes = [
    'Africa/', 'America/', 'Antarctica/', 'Arctic/', 'Asia/',
    'Atlantic/', 'Australia/', 'Europe/', 'Indian/', 'Pacific/'
  ];
  const basicTzs = ['UTC', 'GMT', 'Zulu'];
  return validPrefixes.some(prefix => v.startsWith(prefix)) || basicTzs.includes(v);
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

    // Set timeout for request to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONSTANTS.REQUEST_TIMEOUT_MS);

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
    // Validate response structure (must contain timestamp field)
    if (!responseData || typeof responseData !== 'object' || !('timestamp' in responseData)) {
      throw new Error('Invalid response format: missing timestamp field');
    }

    // Normalize and validate server timestamp
    const rawServerTimestamp = Number(responseData.timestamp);
    const serverTimestamp = normalizeTimestamp(rawServerTimestamp);

    // NTP Step 2: Simulate server receive/send time (simplified for browser environment)
    // In real NTP, these values would come from the server
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

// ===================== Auto Update Core Logic =====================
/**
 * Clear auto update timer (safe to call even if timer is null)
 * Prevents multiple timers from running simultaneously
 */
const clearAutoUpdateTimer = () => {
  if (state.autoUpdateTimer !== null) {
    clearInterval(state.autoUpdateTimer);
    state.autoUpdateTimer = null;
  }
};

/**
 * Core synchronization logic (internal use)
 * Executes multiple sync attempts and selects the most accurate result (lowest network delay)
 * @param serverTimeApi API endpoint to fetch server time
 * @param method HTTP request method (GET/POST)
 * @returns Server timestamp from the most accurate sync attempt (or local time if all fail)
 */
const __sync = async (serverTimeApi: string, method: RequestMethod = 'POST', isAutoUpdate: boolean = false): Promise<number> => {
  // Get sync parameters from constants (ensure valid values)
  const times: number = CONSTANTS.DEFAULT_SYNC_ATTEMPTS;
  const intervalMs: number = CONSTANTS.DEFAULT_SYNC_INTERVAL_MS;
  const validTimes = Math.max(1, Math.round(times)); // At least 1 attempt
  const validInterval = Math.max(CONSTANTS.MIN_SYNC_INTERVAL_MS, Math.round(intervalMs)); // Min 50ms to avoid request congestion

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
  if (syncResults.length === 0 && !isAutoUpdate) {
    state.isSynced = false;
    return Date.now();
  }

  // Select result with lowest network delay (most accurate per NTP best practice)
  const lowestDelayResult = syncResults.reduce((prev, current) => {
    return current.delay < prev.delay ? current : prev;
  });

  // Update global state with the most accurate offset
  state.offset = lowestDelayResult.offset;
  state.isSynced = true; // Mark sync as successful

  // Return server timestamp from the most accurate attempt
  return lowestDelayResult.serverTimestamp;
};

/**
 * Add autoUpdate method to sync promise
 * @param promise Base sync promise
 * @param api Server time API endpoint
 * @param method HTTP request method
 * @returns SyncPromise with autoUpdate method
 */
const __autoUpdate = (promise: Promise<number>, api: string, method: RequestMethod): SyncPromise => {
  const syncPromise = promise as SyncPromise;
  
  syncPromise.autoUpdate = function(intervalMs: number = CONSTANTS.DEFAULT_AUTO_UPDATE_INTERVAL_MS): SyncPromise {
    // Clear existing timer first to prevent multiple timers
    clearAutoUpdateTimer();

    // Only start timer if interval is valid (greater than 0)
    if (intervalMs > 0) {
      state.autoUpdateTimer = setInterval(() => {
        // Re-run sync with last used config (non-blocking)
        __sync(api, method, true);
      }, intervalMs) as unknown as number;
    }
    
    return this; // Return self for method chaining
  };
  
  return syncPromise;
};

// ===================== Core Exports =====================
/**
 * ServerClock - Core time synchronization logic
 * Implements multiple sync attempts and selects the result with lowest network delay
 */
export const ServerClock: ServerClockType = {
  // Getter for sync status (read-only to prevent external modification)
  get isSynced() {
    return state.isSynced;
  },

  /**
   * Public sync method (main entry point for time synchronization)
   * Resets state before each sync and wraps core logic with error handling
   * @param serverTimeApi API endpoint to fetch server time
   * @param method HTTP request method (default: POST)
   * @returns SyncPromise with autoUpdate method
   */
  sync: function (serverTimeApi: string, method: RequestMethod = 'POST'): SyncPromise {
    // Reset sync state before new sync attempts (prevents stale state)
    state.isSynced = false;
    state.offset = 0;

    const syncLogic = async (): Promise<number> => {
      try {
        const timestamp = await __sync(serverTimeApi, method);
        return timestamp;
      } catch (err) {
        state.isSynced = false;
        throw err;
      }
    };

    const rawPromise = syncLogic();
    const enhancedPromise = __autoUpdate(rawPromise, serverTimeApi, method);

    return enhancedPromise;
  }
};

/**
 * ServerTime - Time formatting utilities using synced time
 * Provides timezone-aware date formatting based on synced server time
 */
export const ServerTime: ServerTimeType = {
  /**
   * Get Date object using synced server time (with optional timezone)
   * @param timezone Optional IANA timezone
   * @returns Date object with synced time
   */
  getDate: (timezone?: IANATimezone) => new Date(getServerTimestamp()),
  
  /**
   * Format synced time with custom pattern and optional timezone
   * Supports multiple parameter combinations for flexibility
   * @param arg1 Optional: Format string or IANA timezone
   * @param arg2 Optional: Format string (if arg1 is timezone)
   * @returns Formatted date string
   */
  format: function (
    arg1?: IANATimezone | FormatString,
    arg2?: FormatString
  ): string {
    let tz: IANATimezone | undefined;
    let fmt = DEFAULT_FORMAT;

    // Handle different parameter combinations
    if (arg1 === undefined) {
      // No arguments: use default format and system timezone
    } else if (arg2 === undefined) {
      // Single argument: determine if it's timezone or format string
      tz = isValidTimezone(arg1) ? arg1 : undefined;
      fmt = tz ? DEFAULT_FORMAT : (arg1 as FormatString);
    } else {
      // Two arguments: first is timezone, second is format
      tz = arg1 as IANATimezone;
      fmt = arg2;
    }

    // Format using synced timestamp and resolved options
    return formatDate(new Date(getServerTimestamp()), fmt, tz);
  }
};

// ===================== Default Export =====================
// Default export for convenience (supports both named and default imports)
export default {
  ServerClock,
  ServerTime
} as {
  ServerClock: ServerClockType;
  ServerTime: ServerTimeType;
};