import { supabase } from './supabase';

/**
 * Log application crashes or errors.
 * Matches the query: WHERE error_type = 'crash'
 */
export const logCrash = async (error: Error | string, isFatal: boolean = true, metadata?: any) => {
    try {
        const message = typeof error === 'string' ? error : error.message;
        const stack_trace = typeof error === 'object' && error.stack ? error.stack : null;

        const { error: supabaseError } = await supabase.from('crash_logs').insert({
            error_type: isFatal ? 'crash' : 'error',
            message,
            stack_trace,
            metadata,
            timestamp: new Date().toISOString(),
        });

        if (supabaseError) {
            console.error('Failed to log crash to Supabase:', supabaseError);
        }
    } catch (e) {
        console.error('Failed to log crash:', e);
    }
};

/**
 * Log GPS accuracy and position.
 * Matches the query: SELECT AVG(accuracy_meters)... FROM gps_logs
 */
export const logGps = async (location: { coords: { accuracy: number | null, latitude: number, longitude: number, heading?: number | null, speed?: number | null } }) => {
    try {
        if (location.coords.accuracy === null) return; // metrics rely on accuracy

        const { error: supabaseError } = await supabase.from('gps_logs').insert({
            accuracy_meters: location.coords.accuracy,
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            heading: location.coords.heading,
            speed: location.coords.speed,
            timestamp: new Date().toISOString(),
        });

        if (supabaseError) {
            console.error('Failed to log GPS to Supabase:', supabaseError);
        }
    } catch (e) {
        console.error('Failed to log GPS:', e);
    }
};

/**
 * Log QR Code scan results.
 * Matches the query: SELECT ... FROM qr_logs
 */
export const logQrScan = async (success: boolean, content?: string, metadata?: any) => {
    try {
        const { error: supabaseError } = await supabase.from('qr_logs').insert({
            success,
            content,
            metadata,
            timestamp: new Date().toISOString(),
        });

        if (supabaseError) {
            console.error('Failed to log QR scan to Supabase:', supabaseError);
        }
    } catch (e) {
        console.error('Failed to log QR scan:', e);
    }
};
