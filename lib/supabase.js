import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://agnrzveeoswkscjwxnde.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnbnJ6dmVlb3N3a3Njand4bmRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMzIwNzUsImV4cCI6MjA4ODkwODA3NX0.sHXaPpeVykZ-AySMSjUErWU-73arR6BB47BlQXZjxcU'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)