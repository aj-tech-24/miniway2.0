-- RPC Functions for Account Lockout
-- Run this in Supabase SQL Editor to bypass RLS issues for login lockout

-- 1. Helper to check status (Callable by anon)
CREATE OR REPLACE FUNCTION public.get_lockout_status(email_input TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with admin privileges to read public.users
AS $$
DECLARE
  v_failed_attempts INT;
  v_locked_until TIMESTAMPTZ;
  v_is_locked BOOLEAN;
  v_remaining_minutes INT;
BEGIN
  SELECT failed_login_attempts, locked_until
  INTO v_failed_attempts, v_locked_until
  FROM public.users
  WHERE email = lower(email_input);

  IF NOT FOUND THEN
    RETURN json_build_object(
      'isLocked', false,
      'remainingMinutes', 0,
      'failedAttempts', 0
    );
  END IF;

  v_is_locked := (v_locked_until IS NOT NULL AND v_locked_until > now());
  
  IF v_is_locked THEN
    v_remaining_minutes := CEIL(EXTRACT(EPOCH FROM (v_locked_until - now())) / 60);
  ELSE
    -- If lock expired, we treat it as unlocked (attempts still exist until next login success or failure?)
    -- Usually we want to verify. We'll just return status as is.
    v_remaining_minutes := 0;
  END IF;

  RETURN json_build_object(
    'isLocked', v_is_locked,
    'remainingMinutes', v_remaining_minutes,
    'failedAttempts', COALESCE(v_failed_attempts, 0)
  );
END;
$$;

-- 2. Increment function (Callable by anon)
CREATE OR REPLACE FUNCTION public.increment_failed_login_attempts(email_input TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_failed_attempts INT;
  v_locked_until TIMESTAMPTZ;
  v_new_attempts INT;
  v_should_lock BOOLEAN;
  v_lock_duration_min INT := 15; -- Config: 15 Minutes
  v_max_attempts INT := 5;       -- Config: 5 Attempts
BEGIN
  SELECT id, failed_login_attempts, locked_until
  INTO v_user_id, v_failed_attempts, v_locked_until
  FROM public.users
  WHERE email = lower(email_input);

  IF v_user_id IS NULL THEN
     RETURN json_build_object('success', false);
  END IF;

  -- If currently locked and not expired, just return locked status
  IF v_locked_until IS NOT NULL AND v_locked_until > now() THEN
     RETURN json_build_object(
        'isLocked', true,
        'failedAttempts', v_failed_attempts,
        'remainingMinutes', CEIL(EXTRACT(EPOCH FROM (v_locked_until - now())) / 60)
     );
  END IF;

  -- Else, increment
  v_new_attempts := COALESCE(v_failed_attempts, 0) + 1;
  v_should_lock := v_new_attempts >= v_max_attempts;

  IF v_should_lock THEN
     v_locked_until := now() + (v_lock_duration_min || ' minutes')::INTERVAL;
  ELSE
     v_locked_until := NULL;
  END IF;

  UPDATE public.users
  SET failed_login_attempts = v_new_attempts,
      locked_until = v_locked_until
  WHERE id = v_user_id;

  RETURN json_build_object(
      'isLocked', v_should_lock,
      'failedAttempts', v_new_attempts,
      'remainingMinutes', CASE WHEN v_should_lock THEN v_lock_duration_min ELSE 0 END
  );
END;
$$;

-- 3. Reset function (Callable by anon/authenticated)
CREATE OR REPLACE FUNCTION public.reset_failed_login_attempts(email_input TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.users
  SET failed_login_attempts = 0,
      locked_until = NULL
  WHERE email = lower(email_input);
END;
$$;

-- Grant permissions to anon and authenticated roles
GRANT EXECUTE ON FUNCTION public.get_lockout_status(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_failed_login_attempts(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_failed_login_attempts(text) TO anon, authenticated, service_role;
