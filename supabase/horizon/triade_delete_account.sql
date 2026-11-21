-- Já aplicado no Supabase da Horizon Wear (migração "triade_delete_account").
-- Função nova e isolada: exclui TODOS os dados de um cliente da Horizon Wear em uma única transação.
-- Só o service_role (backend do Tríade) pode executá-la; anon e authenticated não têm acesso.
-- Para desfazer: drop function public.triade_delete_account(uuid);
create or replace function public.triade_delete_account(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_orders uuid[];
  v_hub uuid[];
begin
  select email into v_email from auth.users where id = p_user;
  if not found then
    raise exception 'usuario_nao_encontrado';
  end if;

  -- Contas administrativas não são excluídas por esta página pública.
  if exists (select 1 from public.profiles where id = p_user and role = 'admin')
     or exists (select 1 from public.hub_memberships where user_id = p_user) then
    raise exception 'conta_administrativa';
  end if;

  -- Pedidos da conta e pedidos feitos como convidado com o mesmo e-mail.
  select coalesce(array_agg(id), '{}') into v_orders
  from public.orders
  where user_id = p_user
     or (user_id is null and v_email is not null and lower(email_cliente) = lower(v_email));

  delete from private.stock_reservations where order_id = any(v_orders);
  delete from private.checkout_state where order_id = any(v_orders);
  delete from public.orders where id = any(v_orders); -- cascata: order_items, payments, reviews

  select coalesce(array_agg(id), '{}') into v_hub from public.hub_orders where user_id = p_user;
  delete from public.hub_order_items where order_id = any(v_hub);
  delete from public.hub_orders where id = any(v_hub);

  -- Cascata: profiles (addresses, cart, cart_items, reviews), favorites, hub_memberships, sessões e identidades.
  delete from auth.users where id = p_user;

  return jsonb_build_object('ok', true, 'orders', cardinality(v_orders) + cardinality(v_hub));
end;
$$;

revoke all on function public.triade_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.triade_delete_account(uuid) to service_role;
notify pgrst, 'reload schema';
