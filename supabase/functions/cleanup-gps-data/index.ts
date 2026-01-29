// Supabase Edge Function: cleanup-gps-data
// This function deletes GPS location data older than 24 hours for privacy/compliance
// Schedule this to run periodically (e.g., every hour) via Supabase Dashboard or cron

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RETENTION_HOURS = 24;

interface CleanupResult {
  success: boolean;
  deletedLocationRecords: number;
  clearedTripLocations: number;
  cutoffTime: string;
  timestamp: string;
  error?: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    // Initialize Supabase client with service role key for admin access
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Calculate cutoff time (24 hours ago)
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - RETENTION_HOURS);
    const cutoffISOString = cutoffTime.toISOString();

    console.log(`🧹 Starting GPS data cleanup. Cutoff time: ${cutoffISOString}`);

    // 1. Delete old GPS location history records
    const { data: deletedLocations, error: locationError } = await supabase
      .from("trip_location_history")
      .delete()
      .lt("recorded_at", cutoffISOString)
      .select("id");

    if (locationError) {
      console.error("Error deleting location history:", locationError);
      throw locationError;
    }

    const deletedLocationCount = deletedLocations?.length || 0;
    console.log(`📍 Deleted ${deletedLocationCount} old location history records`);

    // 2. Clear current_location for completed trips older than 24 hours
    const { data: clearedTrips, error: tripError } = await supabase
      .from("trips")
      .update({ current_location: null })
      .eq("status", "completed")
      .lt("updated_at", cutoffISOString)
      .select("id");

    if (tripError) {
      console.error("Error clearing trip locations:", tripError);
      throw tripError;
    }

    const clearedTripCount = clearedTrips?.length || 0;
    console.log(`🚌 Cleared location for ${clearedTripCount} completed trips`);

    // 3. Optionally: Delete very old completed trips (e.g., > 30 days) - uncomment if needed
    // const thirtyDaysAgo = new Date();
    // thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    // await supabase
    //   .from("trips")
    //   .delete()
    //   .eq("status", "completed")
    //   .lt("updated_at", thirtyDaysAgo.toISOString());

    const result: CleanupResult = {
      success: true,
      deletedLocationRecords: deletedLocationCount,
      clearedTripLocations: clearedTripCount,
      cutoffTime: cutoffISOString,
      timestamp: new Date().toISOString(),
    };

    console.log("✅ GPS cleanup completed:", JSON.stringify(result));

    // Log to system_logs table for audit trail (optional)
    try {
      await supabase.from("system_logs").insert({
        action: "gps_data_cleanup",
        details: result,
        created_at: new Date().toISOString(),
      });
    } catch (logError) {
      // Don't fail the function if logging fails
      console.warn("Could not log to system_logs:", logError);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("❌ GPS cleanup error:", errorMessage);

    const errorResult: CleanupResult = {
      success: false,
      deletedLocationRecords: 0,
      clearedTripLocations: 0,
      cutoffTime: "",
      timestamp: new Date().toISOString(),
      error: errorMessage,
    };

    return new Response(JSON.stringify(errorResult), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      status: 500,
    });
  }
});
