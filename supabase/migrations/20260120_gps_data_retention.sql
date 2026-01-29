-- =====================================================
-- GPS Data Retention & Security Setup
-- Run this in Supabase SQL Editor
-- =====================================================

-- 1. Create system_logs table for audit trail (if not exists)
CREATE TABLE IF NOT EXISTS system_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries on action and time
CREATE INDEX IF NOT EXISTS idx_system_logs_action ON system_logs(action);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);

-- 2. Create trip_location_history table for storing GPS history (if not exists)
CREATE TABLE IF NOT EXISTS trip_location_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    trip_id UUID REFERENCES trips(id) ON DELETE CASCADE,
    bus_id UUID REFERENCES buses(id) ON DELETE CASCADE,
    location GEOGRAPHY(POINT, 4326),
    heading REAL,
    speed REAL,
    accuracy REAL,
    recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_trip_location_history_recorded_at 
ON trip_location_history(recorded_at);

CREATE INDEX IF NOT EXISTS idx_trip_location_history_trip_id 
ON trip_location_history(trip_id);

-- 3. Enable RLS on location history table
ALTER TABLE trip_location_history ENABLE ROW LEVEL SECURITY;

-- Policy: Only drivers can insert their own location history
CREATE POLICY "Drivers can insert their own location history"
ON trip_location_history
FOR INSERT
TO authenticated
WITH CHECK (
    EXISTS (
        SELECT 1 FROM trips t
        JOIN buses b ON t.bus_id = b.id
        WHERE t.id = trip_location_history.trip_id
        AND b.driver_id = auth.uid()
    )
);

-- Policy: Admins can view all location history
CREATE POLICY "Admins can view all location history"
ON trip_location_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM users
        WHERE users.id = auth.uid()
        AND users.role = 'admin'
    )
);

-- Policy: Drivers can view their own location history
CREATE POLICY "Drivers can view their own location history"
ON trip_location_history
FOR SELECT
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM trips t
        JOIN buses b ON t.bus_id = b.id
        WHERE t.id = trip_location_history.trip_id
        AND b.driver_id = auth.uid()
    )
);

-- 4. Create a PostgreSQL function for local cleanup (alternative to Edge Function)
CREATE OR REPLACE FUNCTION cleanup_old_gps_data(retention_hours INTEGER DEFAULT 24)
RETURNS JSONB AS $$
DECLARE
    cutoff_time TIMESTAMPTZ;
    deleted_locations INTEGER;
    cleared_trips INTEGER;
    result JSONB;
BEGIN
    -- Calculate cutoff time
    cutoff_time := NOW() - (retention_hours || ' hours')::INTERVAL;
    
    -- Delete old location history records
    WITH deleted AS (
        DELETE FROM trip_location_history
        WHERE recorded_at < cutoff_time
        RETURNING id
    )
    SELECT COUNT(*) INTO deleted_locations FROM deleted;
    
    -- Clear current_location for old completed trips
    WITH updated AS (
        UPDATE trips
        SET current_location = NULL
        WHERE status = 'completed'
        AND updated_at < cutoff_time
        AND current_location IS NOT NULL
        RETURNING id
    )
    SELECT COUNT(*) INTO cleared_trips FROM updated;
    
    -- Build result
    result := jsonb_build_object(
        'success', true,
        'deletedLocationRecords', deleted_locations,
        'clearedTripLocations', cleared_trips,
        'cutoffTime', cutoff_time,
        'timestamp', NOW()
    );
    
    -- Log the cleanup
    INSERT INTO system_logs (action, details, created_at)
    VALUES ('gps_data_cleanup', result, NOW());
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Grant execute permission to service role
GRANT EXECUTE ON FUNCTION cleanup_old_gps_data(INTEGER) TO service_role;

-- 6. Optional: Set up pg_cron for automatic scheduling (if extension is available)
-- Note: pg_cron may not be available on all Supabase plans
-- Uncomment the following if you have access to pg_cron:

-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- SELECT cron.schedule(
--     'cleanup-gps-data-hourly',
--     '0 * * * *',  -- Every hour at minute 0
--     $$SELECT cleanup_old_gps_data(24)$$
-- );

-- To view scheduled jobs:
-- SELECT * FROM cron.job;

-- To remove a scheduled job:
-- SELECT cron.unschedule('cleanup-gps-data-hourly');

-- =====================================================
-- Verification Queries
-- =====================================================

-- Check if tables were created
-- SELECT table_name FROM information_schema.tables 
-- WHERE table_schema = 'public' 
-- AND table_name IN ('system_logs', 'trip_location_history');

-- Check RLS policies
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE tablename = 'trip_location_history';

-- Test the cleanup function manually
-- SELECT cleanup_old_gps_data(24);
