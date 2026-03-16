-- Add payment requisites field to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS payment_info TEXT;
