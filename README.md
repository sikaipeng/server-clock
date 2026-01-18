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

// If you need to output ServerClock logs
// ServerClock.logConfig((level, message) => {
//     console[level](`[ServerClock] ${message}`);
// });

// Basic sync
ServerClock.sync('https://api.your-domain.com/timestamp');
// ServerClock.sync('https://api.your-domain.com/timestamp', 'GET');

// Sync with auto-update (re-sync every 5 minutes by default)
ServerClock.sync('https://api.your-domain.com/timestamp').autoUpdate();
// ServerClock.sync('https://api.your-domain.com/timestamp').autoUpdate(15000);
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
    await ServerClock.sync('https://api.your-domain.com/timestamp');

    // Check sync status
    if (ServerClock.isSynced) {
        console.log('Successfully synced with server time');
    } else {
        console.log('Using local time (sync failed)');
    }
    
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

#### Usage Examples for 12-Hour Format

```ts
// 1. 12-hour format with uppercase AM/PM (system timezone)
ServerTime.format('YYYY-MM-DD hh:mm:ss A'); // "2024-01-15 09:45:30 AM"

// 2. 12-hour format with lowercase am/pm (New York timezone)
ServerTime.format('America/New_York', 'MM/DD/YYYY h:m a'); // "01/15/2024 8:45 pm"

// 3. Mixed 12/24-hour (for reference)
ServerTime.format('Asia/Tokyo', 'YYYY-MM-DD HH:mm (hh:mm A)'); // "2024-01-16 10:45 (10:45 AM)"
```

## API Reference

### ServerClock
Handles time synchronization with remote server and exposes sync status.

| Member | Type | Description | Parameters | Returns |
|--------|------|-------------|------------|---------|
| `isSynced` | `readonly boolean` | **New**: Flag indicating if time synchronization with server was successful (read-only, cannot be modified externally) | - | `boolean` (true = synced with server time, false = using local time) |
| `sync(serverTimeApi: string, method?: RequestMethod)` | `Method` | Synchronizes with server time API, calculates time offset between server and local time (handles asymmetric network delay) | - `serverTimeApi`: URL of the server time API endpoint (must return JSON with `timestamp` field)<br>- `method?`: Request method (`GET`/`POST`), defaults to `POST` | `Promise<number>` (server timestamp in milliseconds UTC; falls back to local timestamp if sync fails) |

### ServerTime
Provides timezone-aware date formatting and Date object retrieval using synced server time.

| Method | Description | Parameters | Returns |
|--------|-------------|------------|---------|
| `getDate(timezone?: IANATimezone)` | Gets a Date object with specified timezone context (uses server time if synced, local time if not) | `timezone?`: Optional IANA timezone (e.g., `Asia/Shanghai`, `UTC`; uses system timezone if not provided) | `Date` (UTC-based Date object with timezone metadata) |
| `format()` | Formats server time to default string format (`YYYY-MM-DD HH:mm:ss`) using system timezone | - | `string` (formatted date string) |
| `format(format: FormatString)` | Formats server time to custom string format using system timezone | `format`: Custom format string (supports `YYYY`, `MM`, `DD`, `HH`, `hh`, `mm`, `ss`, `M`, `D`, `H`, `h`, `m`, `s`, `A`, `a`) | `string` (formatted date string) |
| `format(timezone: IANATimezone)` | Formats server time to default string format using specified timezone | `timezone`: IANA timezone (e.g., `Europe/London`) | `string` (formatted date string) |
| `format(timezone: IANATimezone, format: FormatString)` | Formats server time to custom string format using specified timezone | - `timezone`: IANA timezone<br>- `format`: Custom format string | `string` (formatted date string) |


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