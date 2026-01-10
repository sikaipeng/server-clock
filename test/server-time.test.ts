import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { ServerClock, ServerTime } from '../src/server-time';
import type { IANATimezone } from '../src/timezones';

// Fixed timestamps for deterministic testing (avoid time fluctuation impact)
const FIXED_LOCAL_TIMESTAMP = 1735689600000; // 2025-01-01 00:00:00 UTC (local system time)
const FIXED_SERVER_TIMESTAMP = 1735693200000; // 2025-01-01 01:00:00 UTC (server time)

/**
 * Setup test environment before each test case:
 * 1. Mock global fetch API
 * 2. Freeze system time to fixed timestamp
 * 3. Reset module state to avoid cross-test contamination
 */
beforeEach(() => {
  // Mock fetch API for server time request
  global.fetch = vi.fn();
  
  // Freeze system time to fixed value (critical for time-related test stability)
  vi.useFakeTimers().setSystemTime(FIXED_LOCAL_TIMESTAMP);
  
  // Reset all module mocks and state
  vi.resetModules();
});

/**
 * Clean up test environment after each test case:
 * 1. Restore real timers (undo fake timers)
 * 2. Clear all mock calls and instances
 */
afterEach(() => {
  // Restore real time (critical to avoid affecting other tests)
  vi.useRealTimers();
  
  // Clear all mock data to ensure test isolation
  vi.clearAllMocks();
});

/**
 * Test suite for ServerClock (core time synchronization logic)
 * Covers success/failure scenarios and state management
 */
describe('ServerClock (Time Synchronization)', () => {
  test('sync success: return server timestamp and update sync state', async () => {
    // Mock successful API response with valid server timestamp
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ timestamp: FIXED_SERVER_TIMESTAMP })
    });

    // Execute time synchronization
    const resultTimestamp = await ServerClock.sync('https://api.example.com/server-time');

    // Verify fetch was called correctly
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/server-time');
    
    // Verify sync result matches server timestamp
    expect(resultTimestamp).toBe(FIXED_SERVER_TIMESTAMP);
    
    // Verify ServerTime uses synced server time (local time + offset)
    expect(ServerTime.getDate().getTime()).toBe(FIXED_SERVER_TIMESTAMP);
  });

  test('sync fail: HTTP 500 error, fallback to local system time', async () => {
    // Mock HTTP 500 error response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    });

    // Execute failed sync attempt
    const resultTimestamp = await ServerClock.sync('https://api.example.com/error-time');

    // Verify fallback to local timestamp
    expect(resultTimestamp).toBe(FIXED_LOCAL_TIMESTAMP);
    
    // Verify ServerTime uses local time after sync failure
    expect(ServerTime.getDate().getTime()).toBe(FIXED_LOCAL_TIMESTAMP);
  });

  test('sync fail: invalid response format (missing timestamp field)', async () => {
    // Mock response with incorrect field name (time instead of timestamp)
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ time: FIXED_SERVER_TIMESTAMP })
    });

    const resultTimestamp = await ServerClock.sync('https://api.example.com/bad-format');

    // Verify fallback to local time
    expect(resultTimestamp).toBe(FIXED_LOCAL_TIMESTAMP);
    
    // Verify formatted time matches fixed local time
    expect(ServerTime.format()).toBe('2025-01-01 00:00:00');
  });

  test('sync fail: non-numeric timestamp value', async () => {
    // Mock response with non-numeric timestamp (invalid type)
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ timestamp: 'invalid' })
    });

    const resultTimestamp = await ServerClock.sync('https://api.example.com/invalid-timestamp');

    // Verify fallback to local time
    expect(resultTimestamp).toBe(FIXED_LOCAL_TIMESTAMP);
    expect(ServerTime.getDate().getTime()).toBe(FIXED_LOCAL_TIMESTAMP);
  });

  test('sync fail: network error (fetch throws exception)', async () => {
    // Mock network error (fetch promise rejection)
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Failed to fetch'));

    const resultTimestamp = await ServerClock.sync('https://invalid-url.example.com/time');

    // Verify fallback to local time even with network error
    expect(resultTimestamp).toBe(FIXED_LOCAL_TIMESTAMP);
    
    // Verify timezone-specific getDate still returns local time
    expect(ServerTime.getDate('Asia/Shanghai').getTime()).toBe(FIXED_LOCAL_TIMESTAMP);
  });

  test('multiple sync attempts: fail first then success, state updated correctly', async () => {
    // First sync attempt: network error (failure)
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Failed to fetch'));
    await ServerClock.sync('https://invalid-url.example.com/time');
    expect(ServerTime.getDate().getTime()).toBe(FIXED_LOCAL_TIMESTAMP);

    // Second sync attempt: successful response
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ timestamp: FIXED_SERVER_TIMESTAMP })
    });
    await ServerClock.sync('https://api.example.com/server-time');
    
    // Verify state updated to use server time after successful retry
    expect(ServerTime.getDate().getTime()).toBe(FIXED_SERVER_TIMESTAMP);
  });
});

/**
 * Test suite for ServerTime (time formatting and timezone conversion)
 * Covers different parameter combinations and sync states
 */
describe('ServerTime (Time Output)', () => {
  test('getDate without params: sync success → return server time (system timezone)', async () => {
    // Setup successful sync first
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ timestamp: FIXED_SERVER_TIMESTAMP })
    });
    await ServerClock.sync('https://api.example.com/server-time');

    // Get date without timezone parameter (uses system timezone)
    const date = ServerTime.getDate();
    
    // Verify timestamp matches server time
    expect(date.getTime()).toBe(FIXED_SERVER_TIMESTAMP);
    // Verify year value (basic date validation)
    expect(date.getFullYear()).toBe(2025);
  });

  test('getDate with timezone: sync fail → return local time (specified timezone)', async () => {
    // Setup failed sync (HTTP 500)
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500
    });
    await ServerClock.sync('https://api.example.com/error-time');

    // Get date with Shanghai timezone (UTC+8)
    const shanghaiDate = ServerTime.getDate('Asia/Shanghai');
    
    // Verify UTC year (timezone-agnostic validation)
    expect(shanghaiDate.getUTCFullYear()).toBe(2025);
    // Verify UTC hours (Shanghai = UTC+8 → 0 + 8 = 8)
    expect(shanghaiDate.getUTCHours()).toBe(8);
    // Verify timestamp still matches fixed local time
    expect(shanghaiDate.getTime()).toBe(FIXED_LOCAL_TIMESTAMP);
  });

  test('format scenario: specified timezone + custom format (sync success)', async () => {
    // Setup successful sync
    await ServerClock.sync('https://api.example.com/server-time');
    
    // Format with London timezone (UTC+0) and custom format
    const formatted = ServerTime.format('Europe/London', 'YYYY-MM-DD HH:mm:ss');
    
    // Verify formatted string matches server time in London timezone
    expect(formatted).toBe('2025-01-01 01:00:00');
  });

  test('format scenario: only custom format (sync fail)', async () => {
    // Setup failed sync (network error)
    await ServerClock.sync('https://invalid-url.example.com/time');
    
    // Format with only time format (no timezone, uses local time)
    const formatted = ServerTime.format('HH:mm:ss');
    
    // Verify formatted time matches fixed local time
    expect(formatted).toBe('00:00:00');
  });

  test('format default params: sync fail → local time + default format', async () => {
    // Setup failed sync (HTTP 500)
    await ServerClock.sync('https://api.example.com/error-time');
    
    // Format with default parameters (no args)
    const formatted = ServerTime.format();
    
    // Verify formatted string matches fixed local time with default format
    expect(formatted).toBe('2025-01-01 00:00:00');
  });
});

/**
 * Test suite for edge cases
 * Covers scenarios like no sync, invalid timezone, etc.
 */
describe('Edge Cases', () => {
  test('no sync called: use local system time directly', () => {
    // Call ServerTime without any prior sync
    const date = ServerTime.getDate();
    
    // Verify timestamp matches fixed local time
    expect(date.getTime()).toBe(FIXED_LOCAL_TIMESTAMP);
    
    // Verify formatted date with custom format
    const formatted = ServerTime.format('YYYY-MM-DD');
    expect(formatted).toBe('2025-01-01');
  });

  test('timezone conversion fail: fallback to system timezone', async () => {
    // Setup successful sync first
    await ServerClock.sync('https://api.example.com/server-time');
    
    // Attempt to use invalid timezone (type cast to bypass TS validation)
    const date = ServerTime.getDate('Invalid/Timezone' as unknown as IANATimezone);
    
    // Verify timestamp remains correct (server time) even with invalid timezone
    // Note: Timezone conversion fails but timestamp should not change
    expect(date.getTime()).toBe(FIXED_SERVER_TIMESTAMP);
  });
});