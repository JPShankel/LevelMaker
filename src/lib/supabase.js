import { createClient } from '@supabase/supabase-js';

// ─── Supabase setup ────────────────────────────────────────────────────────────
// Run the following SQL once in your Supabase dashboard (SQL Editor):
//
//   create table levels (
//     id          uuid primary key default gen_random_uuid(),
//     user_id     uuid references auth.users not null default auth.uid(),
//     name        text not null,
//     data        jsonb not null,
//     created_at  timestamptz default now()
//   );
//
//   alter table levels enable row level security;
//
//   create policy "Users manage own levels" on levels
//     for all
//     using  (auth.uid() = user_id)
//     with check (auth.uid() = user_id);
// ──────────────────────────────────────────────────────────────────────────────

export const supabase = createClient(
  'https://sziwjfiywvfcmxshtrdq.supabase.co',
  'sb_publishable_ycGn76y0UVMIKEm4Z3FQgw_SjjyeLOG'
);
