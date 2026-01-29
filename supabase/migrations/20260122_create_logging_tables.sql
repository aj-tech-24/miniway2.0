-- Create crash_logs table
CREATE TABLE IF NOT EXISTS crash_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    error_type TEXT,
    message TEXT,
    stack_trace TEXT,
    metadata JSONB,
    user_id UUID REFERENCES auth.users(id)
);

-- Create gps_logs table
CREATE TABLE IF NOT EXISTS gps_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    accuracy_meters FLOAT,
    latitude FLOAT,
    longitude FLOAT,
    heading FLOAT,
    speed FLOAT,
    user_id UUID REFERENCES auth.users(id)
);

-- Create qr_logs table
CREATE TABLE IF NOT EXISTS qr_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    success BOOLEAN,
    content TEXT,
    metadata JSONB,
    user_id UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE crash_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE gps_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_logs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow insert for authenticated users" ON crash_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow read for authenticated users" ON crash_logs FOR SELECT TO authenticated USING (true); -- Maybe restrict this later

CREATE POLICY "Allow insert for authenticated users" ON gps_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow read for authenticated users" ON gps_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow insert for authenticated users" ON qr_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow read for authenticated users" ON qr_logs FOR SELECT TO authenticated USING (true);


-- Create Views based on user request

-- App Crashes (Page 39)
CREATE OR REPLACE VIEW view_app_crashes AS
SELECT COUNT(*) as crashes, DATE(timestamp) as crash_date
FROM crash_logs
WHERE error_type = 'crash'
GROUP BY DATE(timestamp);

-- GPS Accuracy (Page 39)
CREATE OR REPLACE VIEW view_gps_accuracy AS
SELECT
AVG(accuracy_meters) as avg_accuracy,
MIN(accuracy_meters) as best,
MAX(accuracy_meters) as worst
FROM gps_logs;

-- QR Success Rate (97.3% target)
CREATE OR REPLACE VIEW view_qr_success_rate AS
SELECT
COUNT(CASE WHEN success=true THEN 1 END) * 100.0 / NULLIF(COUNT(*), 0) as success_rate
FROM qr_logs;
