# server-clock

A robust TypeScript library for fetching authoritative server time and timezone-aware date formatting in Node.js/browser environments. This library ensures consistent time representation across distributed systems by using server time as the trusted time source and providing flexible formatting options with IANA timezone support.

## Features

- 🔄 Fetch authoritative server time with fallback to local time
- ⏰ Timezone-aware date formatting (supports all IANA timezones)
- 🎨 Custom date format strings (uses `YYYY-MM-DD HH:mm:ss` syntax)
- 🔍 Automatic timestamp unit detection (seconds/milliseconds)
- ✅ Full TypeScript type safety with no implicit `any` types
- 🚫 Zero external dependencies (relies on native `Intl` API)

## Installation

```bash
# npm
npm install server-clock

# pnpm
pnpm add server-clock

# yarn
yarn add server-clock
```

## Usage

### Basic Time Synchronization
First, synchronize with server's time API (the API must return a JSON object with a timestamp field in UTC seconds or milliseconds):

```ts
import { ServerClock } from 'server-clock';
// Use ServerClock directly
await ServerClock.sync('https://api.your-domain.com/server-time');
```

### Date Formatting
The format function supports 4 flexible calling patterns:

```ts
import { ServerTime } from 'server-clock';

// 1. No parameters (default format + system timezone)
const defaultFormatted = ServerTime.format();
// Output example: "2026-01-08 14:30:45"

// 2. Only format string (custom format + system timezone)
const customFormat = ServerTime.format('YYYY/MM/DD');
// Output example: "2026/01/08"

// 3. Only timezone (default format + specified timezone)
const tokyoTime = ServerTime.format('Asia/Tokyo');
// Output example: "2026-01-09 00:30:45"

// 4. Timezone + format string (custom format + specified timezone)
const newYorkTime = ServerTime.format('America/New_York', 'HH:mm:ss');
// Output example: "09:30:45"
```

### Get Timezone-Aware Date Object
Retrieve a Date object with server time (timezone-aware):

```ts
import { ServerTime } from 'server-clock';

// System timezone
const currentDate = ServerTime.getDate();

// Specific timezone (returns UTC Date object with correct timestamp)
const parisDate = ServerTime.getDate('Europe/Paris');
```

### Example

```ts
import { ServerClock, ServerTime } from 'server-clock';

async function initializeServerTime() {
    // Sync with server time
    await ServerClock.sync('https://lamhoi.co.uk/timestamp');
    //await ServerClock.sync('https://api.your-domain.com/timestamp', 'GET');
    
    // Get formatted times for different timezones
    const utcTime = ServerTime.format('UTC', 'YYYY-MM-DD HH:mm:ss');
    const beijingTime = ServerTime.format('Asia/Shanghai', 'YYYY-MM-DD HH:mm:ss');
    const losAngelesTime = ServerTime.format('America/Los_Angeles', 'YYYY-MM-DD HH:mm:ss');
    
    console.log('UTC Time:', utcTime);
    console.log('Beijing Time:', beijingTime);
    console.log('Los Angeles Time:', losAngelesTime);
    
    // Get Date object for Tokyo timezone
    const tokyoDate = ServerTime.getDate('Asia/Tokyo');
    console.log('Tokyo Date:', tokyoDate);
}

// Initialize
initializeServerTime();
```

## API Reference

### ServerClock

| Method | Description | Parameters | Returns |
| --- | --- | --- | --- |
| sync(serverTimeApi: string) | Synchronizes with server time API, calculates time offset between server and local time | serverTimeApi: URL of the server time API endpoint | Promise<number> (server timestamp in milliseconds UTC) |

### ServerTime

| Method | Description | Returns |
| --- | --- | --- |
| getDate(timezone?: IANATimezone) | Gets a Date object with server time (falls back to local time if sync failed) | Date |
| format() | Formats server time with default format (YYYY-MM-DD HH:mm:ss) and system timezone | string |
| format(format: FormatString) | Formats server time with custom format and system timezone | string |
| format(timezone: IANATimezone) | Formats server time with default format and specified timezone | string |
| format(timezone: IANATimezone, format: FormatString) | Formats server time with custom format and specified timezone | string |

### Error Handling
- The sync method gracefully handles:
  - Network errors (failed requests, timeouts)
  - Invalid HTTP responses (non-200 status codes)
  - Invalid response formats (missing timestamp field)
  - Invalid timestamp values (non-numeric, infinite values)
- If synchronization fails, the library automatically falls back to local time
- All errors are logged to the console (warn level) but do not throw uncaught exceptions

### Server API Requirements
Server time API should return a JSON response with the following structure:

```json
{
  "timestamp": 1735693200000
}
```

- Timestamp can be in seconds (10 digits) or milliseconds (13 digits)
- The library automatically detects and normalizes the unit to milliseconds

## Environment Requirements

### Browser Support
- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ support required
- Relies on Intl.DateTimeFormat API (supported in all modern browsers)

### Node.js Support
- Node.js 12.x or higher
- No additional dependencies required

## License
This project is open source and available under the MIT License.

## Issues
If you find a bug or have a feature request, please create an issue on the GitHub repository.