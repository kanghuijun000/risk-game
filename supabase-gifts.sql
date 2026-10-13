-- Risk Game 친구 선물 기능: Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.
alter table public.profiles add column if not exists current_budget bigint not null default 10000;
alter table public.profiles add column if not exists last_seen_at timestamptz;
create table if not exists public.friend_gifts(id uuid primary key default gen_random_uuid(),sender_id uuid not null references auth.users(id) on delete cascade,receiver_id uuid not null references auth.users(id) on delete cascade,sender_name text not null check(char_length(sender_name) between 1 and 20),amount bigint not null check(amount>0 and amount<=9000000000000),status text not null default 'pending' check(status in ('pending','accepted')),created_at timestamptz not null default now(),accepted_at timestamptz,constraint friend_gifts_no_self check(sender_id<>receiver_id));
create index if not exists friend_gifts_receiver_created_idx on public.friend_gifts(receiver_id,created_at desc);
create index if not exists friend_gifts_sender_created_idx on public.friend_gifts(sender_id,created_at desc);
alter table public.friend_gifts enable row level security;
drop policy if exists "friend_gifts_select_participant" on public.friend_gifts;
create policy "friend_gifts_select_participant" on public.friend_gifts for select to authenticated using(sender_id=(select auth.uid()) or receiver_id=(select auth.uid()));
revoke all on public.friend_gifts from anon,authenticated;grant select on public.friend_gifts to authenticated;
create or replace function public.send_risk_game_gift(p_receiver_id uuid,p_amount bigint) returns table(gift_id uuid,amount bigint,sender_budget bigint) language plpgsql security definer set search_path='' as $gift$
declare sender uuid:=auth.uid(); sender_profile public.profiles%rowtype; receiver_profile public.profiles%rowtype;
begin
 if sender is null then raise exception '온라인 계정 연결이 필요합니다.';end if;
 if p_receiver_id is null or p_receiver_id=sender then raise exception '자기 자신에게 선물할 수 없습니다.';end if;
 if p_amount is null or p_amount<=0 or p_amount>9000000000000 then raise exception '선물 금액은 1원부터 9조 원까지 입력할 수 있습니다.';end if;
 if not exists(select 1 from public.user_friends f where f.user_id=sender and f.friend_id=p_receiver_id) or not exists(select 1 from public.user_friends f where f.user_id=p_receiver_id and f.friend_id=sender) then raise exception '현재 친구 관계인 계정에게만 선물할 수 있습니다.';end if;
 select p.* into sender_profile from public.profiles p where p.id=sender for update;
 if not found then raise exception '보내는 사람의 프로필을 찾을 수 없습니다.';end if;
 select p.* into receiver_profile from public.profiles p where p.id=p_receiver_id;
 if not found then raise exception '받는 사람의 프로필을 찾을 수 없습니다.';end if;
 if coalesce(sender_profile.current_budget,0)<p_amount then raise exception '온라인 예산이 부족합니다. 친구 목록을 새로고침한 뒤 다시 시도하세요.';end if;
 update public.profiles set current_budget=current_budget-p_amount where id=sender;
 return query insert into public.friend_gifts(sender_id,receiver_id,sender_name,amount) values(sender,p_receiver_id,sender_profile.display_name,p_amount) returning friend_gifts.id,friend_gifts.amount,sender_profile.current_budget-p_amount;
end;$gift$;
create or replace function public.accept_risk_game_gift(p_gift_id uuid) returns table(gift_id uuid,amount bigint,sender_name text) language plpgsql security definer set search_path='' as $claim$
declare gift public.friend_gifts%rowtype;
begin
 if auth.uid() is null then raise exception '온라인 계정 연결이 필요합니다.';end if;
 select g.* into gift from public.friend_gifts g where g.id=p_gift_id and g.receiver_id=auth.uid() for update;
 if not found then raise exception '받을 수 있는 선물을 찾을 수 없습니다.';end if;
 if gift.status<>'pending' then raise exception '이미 받은 선물입니다.';end if;
 update public.profiles set current_budget=current_budget+gift.amount where id=auth.uid();
 if not found then raise exception '받는 사람의 프로필을 찾을 수 없습니다.';end if;
 update public.friend_gifts set status='accepted',accepted_at=now() where id=gift.id;
 return query select gift.id,gift.amount,gift.sender_name;
end;$claim$;
revoke all on function public.send_risk_game_gift(uuid,bigint) from public,anon;
revoke all on function public.accept_risk_game_gift(uuid) from public,anon;
grant execute on function public.send_risk_game_gift(uuid,bigint) to authenticated;
grant execute on function public.accept_risk_game_gift(uuid) to authenticated;
