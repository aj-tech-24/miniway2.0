-- Conductor creation script with completely valid UUIDs
-- This script creates a conductor user with proper UUID format

-- First, let's check if there are any existing conductors
SELECT 
  u.id,
  u."fullName",
  u.role,
  au.email
FROM public.users u
LEFT JOIN auth.users au ON u.id = au.id
WHERE u.role = 'conductor'
ORDER BY u.updated_at DESC;

-- Create conductor with valid UUIDs (only 0-9, a-f characters)
INSERT INTO auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890', -- Valid UUID format
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'conductor.test@miniway.com',
  crypt('conductor123', gen_salt('bf')),
  NOW(),
  NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"fullName": "John Conductor"}',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create the public.users record
INSERT INTO public.users (
  id,
  "fullName",
  avatar_url,
  role,
  updated_at,
  contact_number,
  emergency_contact,
  home_location,
  work_location,
  push_token,
  license_expiry,
  license_number
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'John Conductor',
  NULL,
  'conductor',
  NOW(),
  '+1234567890',
  '+1987654321',
  '123 Main Street, City, State 12345',
  '456 Bus Depot Road, City, State 12345',
  NULL,
  '2025-12-31',
  'CD123456789'
) ON CONFLICT (id) DO NOTHING;

-- Create a bus for the conductor (using valid UUID - no 'g' character)
INSERT INTO public.buses (
  id,
  plate_number,
  capacity,
  passengers,
  status,
  driver_id,
  conductor_id,
  created_at,
  updated_at
) VALUES (
  'b2c3d4e5-f6a7-8901-bcde-f23456789012', -- Valid UUID format
  'BUS-001',
  50,
  0,
  'inactive',
  NULL,
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  NOW(),
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Create a route (using valid UUID - no 'g' character)
INSERT INTO public.routes (
  id,
  name,
  path,
  start_address,
  end_address,
  created_at
) VALUES (
  'c3d4e5f6-a7a8-9012-cdef-345678901234', -- Fixed: changed 'g' to 'a'
  'Downtown Express',
  ST_GeomFromText('LINESTRING(-74.0059 40.7128, -74.0060 40.7129)', 4326), -- Geography path
  'Central Station, Main Street',
  'University Campus, College Avenue',
  NOW()
) ON CONFLICT (id) DO NOTHING;

-- Assign route to bus
UPDATE public.buses 
SET route_id = 'c3d4e5f6-a7a8-9012-cdef-345678901234'
WHERE id = 'b2c3d4e5-f6a7-8901-bcde-f23456789012';

-- Display the conductor information
SELECT 
  u.id,
  u."fullName",
  u.role,
  u.contact_number,
  u.license_number,
  b.plate_number as assigned_bus,
  b.capacity as bus_capacity,
  r.name as route_name,
  r.start_address,
  r.end_address,
  au.email
FROM public.users u
LEFT JOIN public.buses b ON u.id = b.conductor_id
LEFT JOIN public.routes r ON b.route_id = r.id
LEFT JOIN auth.users au ON u.id = au.id
WHERE u.id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
