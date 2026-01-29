# GPS Data Cleanup Edge Function

This Supabase Edge Function automatically deletes GPS location data older than 24 hours to comply with data retention policies and privacy requirements.

## Features

- ✅ Deletes `trip_location_history` records older than 24 hours
- ✅ Clears `current_location` for completed trips older than 24 hours
- ✅ Logs cleanup results to `system_logs` table for audit trail
- ✅ CORS support for manual invocations
- ✅ Detailed error handling and logging

## Security Compliance

This function helps ensure:
- **Data Minimization**: GPS data is not retained longer than necessary
- **Privacy**: User location history is automatically purged
- **GDPR/CCPA Compliance**: Supports right to erasure and data retention limits

## Deployment

### Prerequisites

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Login to Supabase:
   ```bash
   supabase login
   ```

3. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```

### Deploy the Function

```bash
supabase functions deploy cleanup-gps-data
```

### Set Up Database Tables

Run the migration SQL in your Supabase SQL Editor:
- File: `supabase/migrations/20260120_gps_data_retention.sql`

## Scheduling

### Option 1: Supabase Dashboard (Recommended)

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Find `cleanup-gps-data`
3. Click **Schedules** → **Add Schedule**
4. Set cron expression: `0 * * * *` (every hour at minute 0)

### Option 2: External Cron Service

Use services like:
- **GitHub Actions** with scheduled workflows
- **Vercel Cron Jobs**
- **Railway Cron**
- **EasyCron**

Example GitHub Actions workflow:

```yaml
name: GPS Data Cleanup
on:
  schedule:
    - cron: '0 * * * *'  # Every hour

jobs:
  cleanup:
    runs-on: ubuntu-latest
    steps:
      - name: Invoke cleanup function
        run: |
          curl -X POST \
            'https://your-project.supabase.co/functions/v1/cleanup-gps-data' \
            -H 'Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}'
```

### Option 3: pg_cron (PostgreSQL Extension)

If your Supabase plan supports pg_cron:

```sql
SELECT cron.schedule(
    'cleanup-gps-data-hourly',
    '0 * * * *',
    $$SELECT cleanup_old_gps_data(24)$$
);
```

## Manual Invocation

### Using cURL

```bash
curl -X POST \
  'https://your-project.supabase.co/functions/v1/cleanup-gps-data' \
  -H 'Authorization: Bearer YOUR_ANON_KEY' \
  -H 'Content-Type: application/json'
```

### Using JavaScript

```javascript
const { data, error } = await supabase.functions.invoke('cleanup-gps-data');
console.log(data);
// {
//   success: true,
//   deletedLocationRecords: 150,
//   clearedTripLocations: 25,
//   cutoffTime: "2026-01-19T10:00:00.000Z",
//   timestamp: "2026-01-20T10:00:00.000Z"
// }
```

## Response Format

### Success Response (200)

```json
{
  "success": true,
  "deletedLocationRecords": 150,
  "clearedTripLocations": 25,
  "cutoffTime": "2026-01-19T10:00:00.000Z",
  "timestamp": "2026-01-20T10:00:00.000Z"
}
```

### Error Response (500)

```json
{
  "success": false,
  "deletedLocationRecords": 0,
  "clearedTripLocations": 0,
  "cutoffTime": "",
  "timestamp": "2026-01-20T10:00:00.000Z",
  "error": "Error message here"
}
```

## Configuration

### Changing Retention Period

Edit `RETENTION_HOURS` in `index.ts`:

```typescript
const RETENTION_HOURS = 24;  // Change to desired hours
```

## Monitoring

### View Logs

```bash
supabase functions logs cleanup-gps-data
```

### Check Cleanup History

```sql
SELECT * FROM system_logs 
WHERE action = 'gps_data_cleanup' 
ORDER BY created_at DESC 
LIMIT 10;
```

## Troubleshooting

### Function Not Running

1. Check if function is deployed: `supabase functions list`
2. Check logs: `supabase functions logs cleanup-gps-data`
3. Verify environment variables are set in Supabase Dashboard

### No Data Being Deleted

1. Verify `trip_location_history` table exists
2. Check if there's data older than 24 hours
3. Run manually and check response

### Permission Errors

1. Ensure `SUPABASE_SERVICE_ROLE_KEY` is set
2. Check RLS policies on target tables
