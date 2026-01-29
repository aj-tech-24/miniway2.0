-- Account Lockout Feature Migration
-- Run this SQL in your Supabase SQL Editor

-- 1. Add email column if it doesn't exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS email TEXT;

-- 2. Backfill email from auth.users for existing records
UPDATE public.users pu
SET email = au.email
FROM auth.users au
WHERE pu.id = au.id
AND pu.email IS NULL;

-- 3. Add columns for tracking failed login attempts and lockout status
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

-- 4. Create an index for faster lockout checks on email
CREATE INDEX IF NOT EXISTS idx_users_email_lockout 
ON public.users (email, locked_until);

-- 5. UPDATE TRIGGER FUNCTION
-- This updates your existing handle_new_user function to include the email field
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, "fullName", role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'role');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Helper function to reset expired lockouts (Optional)
CREATE OR REPLACE FUNCTION reset_expired_lockouts()
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET failed_login_attempts = 0, locked_until = NULL
  WHERE locked_until IS NOT NULL AND locked_until < NOW();
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN public.users.email IS 'User email address, synced from auth.users.';
