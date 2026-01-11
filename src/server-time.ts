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
   */
  format: ServerTimeFormatFn;
}

/**
 * Type definition for ServerClock object (time synchronization logic)
 */
interface ServerClockType {
  /**
   * Synchronize time with remote server via API
   * @param serverTimeApi API endpoint to fetch server timestamp (UTC milliseconds)
   * @returns Promise with server timestamp (local timestamp if sync fails, UTC milliseconds)
   */
  sync: (serverTimeApi: string, method?: RequestMethod) => Promise<number>;
}

// ===================== Internal Global State =====================
/**
 * State management for time synchronization
 * - timeOffset: NTP-calculated time offset (milliseconds)
 * - networkDelay: NTP-calculated network delay (milliseconds)
 * - isSynced: Flag indicating if time sync with server was successful
 */
interface ServerTimeState {
  timeOffset: number;
  networkDelay: number;
  isSynced: boolean;
}

// Initialize sync state (no offset/delay, not synced initially)
const state: ServerTimeState = { 
  timeOffset: 0, 
  networkDelay: 0,
  isSynced: false 
};

// ===================== Internal Utility Constants & Functions =====================
/**
 * Date format handlers (immutable object)
 * Maps format tokens to timezone-aware date value getters
 */
const FORMAT_HANDLERS = {
  YYYY: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'year', tz),
  MM: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'month', tz),
  DD: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'day', tz),
  HH: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'hour', tz),
  mm: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'minute', tz),
  ss: (date: Date, tz?: IANATimezone) => getTimezoneDatePart(date, 'second', tz)
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
 * @returns Server timestamp (UTC milliseconds) if synced, local timestamp if failed
 */
const getServerTimestamp = (): number => {
  const now = Date.now();
  return state.isSynced ? now + state.timeOffset : now;
};

/**
 * Get timezone-aware date part from UTC timestamp
 * Fix TS1016: Required parameter follows optional parameter → reorder parameters
 * @param date UTC-based Date object (required)
 * @param part Date part to retrieve (required: year/month/day/hour/minute/second)
 * @param tz Optional IANA timezone (system timezone if not provided)
 * @returns Formatted string (2/4 digit) for the target timezone
 */
const getTimezoneDatePart = (
  date: Date,
  part: 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second',
  tz?: IANATimezone
): string => {
  // Use system timezone if not specified
  const timeZone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  // Configure Intl options for timezone-aware parsing
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    [part]: part === 'year' ? 'numeric' : '2-digit',
    hour12: false // Force 24-hour format
  };

  // Get raw part value from Intl API (timezone-aware)
  const partValue = new Intl.DateTimeFormat('en-US', options)
    .formatToParts(date)
    .find(p => p.type === part)?.value || '';

  // Pad with leading zero for consistent formatting
  return part === 'year' 
    ? partValue.padStart(4, '0') 
    : partValue.padStart(2, '0');
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

// ===================== Core Exports =====================
/**
 * ServerClock - Core time synchronization logic
 * Handles fetching server time, NTP calculation, and managing sync state
 */
export const ServerClock: ServerClockType = {
  sync: async (serverTimeApi: string, method: RequestMethod = 'POST'): Promise<number> => {
    // Reset state before sync
    state.isSynced = false;
    state.timeOffset = 0;
    state.networkDelay = 0;

    try {
      // === NTP Time Capture: t1 (client send time) ===
      const t1 = Date.now();

      // Construct fetch request configuration
      const fetchOptions: RequestInit = {
        method: method, // Use the passed method (POST by default)
        // Optional: Add default Content-Type for POST requests to adapt to JSON APIs
        ...(method === 'POST' && {
          headers: {
            'Content-Type': 'application/json'
          }
        })
      };

      const response = await fetch(serverTimeApi, fetchOptions);
      if (!response.ok) {
        throw new Error(`HTTP request failed: ${response.status} ${response.statusText}`);
      }

      const responseData = await response.json();
      if (!responseData || typeof responseData !== 'object' || !('timestamp' in responseData)) {
        throw new Error('Invalid response format: missing timestamp field');
      }

      // === NTP Core Calculation ===
      // Server timestamp
      const rawServerTimestamp = Number(responseData.timestamp);
      if (isNaN(rawServerTimestamp) || !Number.isFinite(rawServerTimestamp)) {
        throw new Error('Timestamp is not a valid number');
      }
      const serverTimestamp = normalizeTimestamp(rawServerTimestamp); // Server receive time

      // === NTP Time Capture: t4 (client receive time) ===
      const t4 = Date.now();

      // Calculate NTP delay and offset
      const t2 = serverTimestamp - 100; // Server receive time
      const t3 = serverTimestamp + 100; // Server send time
      // Network delay = (client round-trip time)
      const networkDelay = ((t4 - t1) - (t3 - t2)) / 2;
      // Time offset = [(server receive time - client send time) + (server send time - client receive time)] / 2
      const timeOffset = ((t2 - t1) + (t3 - t4)) / 2;

      // Update global state with NTP results
      state.networkDelay = Math.max(0, networkDelay); // Delay cannot be negative
      state.timeOffset = timeOffset;
      state.isSynced = true;

      // Calculate current server time (for return value)
      const currentServerTime = t3 + networkDelay;

      console.log(`[ServerClock] Time sync successful:
        - Server UTC timestamp: ${serverTimestamp} (${new Date(serverTimestamp).toUTCString()})
        - Network delay: ${state.networkDelay}ms
        - Time offset: ${state.timeOffset.toFixed(2)}ms
        - Current server time: ${new Date(currentServerTime).toUTCString()}`);
      
      return currentServerTime;
    } catch (error) {
      const localTimestamp = Date.now();
      console.warn(
        `[ServerClock] Time sync failed, fallback to local time: ${(error as Error).message}`
      );
      return localTimestamp;
    }
  }
};

/**
 * Get timezone-aware Date object (returns UTC Date with correct timezone context)
 * @param timezone Optional IANA timezone
 * @returns Date object (UTC timestamp with timezone metadata)
 */
const getDateFunction = (timezone?: IANATimezone): Date => {
  const utcTimestamp = getServerTimestamp();
  // Return UTC Date object (timezone conversion handled in formatting)
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

// ===================== Convenience Exports =====================
/**
 * Convenience export for ServerClock.sync (simpler import)
 */
export const sync = ServerClock.sync;

/**
 * Convenience export for ServerTime.getDate (simpler import)
 */
export const getDate = ServerTime.getDate;

/**
 * Convenience export for ServerTime.format (simpler import)
 */
export const format = ServerTime.format;

// ===================== Default Export =====================
export default {
  ServerClock,
  ServerTime
} as {
  ServerClock: ServerClockType;
  ServerTime: ServerTimeType;
};