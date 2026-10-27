-- Function to create the first admin user
-- This function should be called after creating a user in Supabase Auth
-- Usage: select public.create_first_admin_user('user-uuid-here');

create or replace function public.create_first_admin_user(user_uuid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  user_record auth.users;
  profile_record public.user_profiles;
begin
  -- Check if user exists in auth
  select * into user_record from auth.users where id = user_uuid;
  
  if user_record is null then
    return jsonb_build_object('success', false, 'error', 'User not found in auth.users');
  end if;
  
  -- Check if profile already exists
  select * into profile_record from public.user_profiles where id = user_uuid;
  
  if profile_record is not null then
    -- Update existing profile to owner role
    update public.user_profiles
    set role = 'owner', is_active = true
    where id = user_uuid;
    
    return jsonb_build_object('success', true, 'message', 'Existing profile updated to owner role');
  end if;
  
  -- Create new profile with owner role
  insert into public.user_profiles (id, full_name, role, is_active)
  values (user_uuid, coalesce(user_record.raw_user_meta_data->>'full_name', 'Admin'), 'owner', true);
  
  return jsonb_build_object('success', true, 'message', 'New admin profile created');
end;
$$;

-- Grant execute to authenticated users
revoke all on function public.create_first_admin_user(uuid) from public;
grant execute on function public.create_first_admin_user(uuid) to authenticated;
