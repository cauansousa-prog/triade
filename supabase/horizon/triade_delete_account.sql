-- Exclusão de conta da Horizon Wear com anonimização de pedidos.
-- A conta, perfil, endereços, carrinho, favoritos, sessões e identidades são removidos.
-- Pedidos e pagamentos são preservados como registros transacionais, sem dados pessoais do cliente.
-- Apenas service_role pode chamar esta função pelo backend do Tríade.
create or replace function public.triade_delete_account(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_orders uuid[];
  v_order_count integer := 0;
  v_hub_count integer := 0;
begin
  select email into v_email from auth.users where id = p_user;
  if not found then
    raise exception 'usuario_nao_encontrado';
  end if;

  if exists (select 1 from public.profiles where id = p_user and role = 'admin')
     or exists (select 1 from public.hub_memberships where user_id = p_user) then
    raise exception 'conta_administrativa';
  end if;

  select coalesce(array_agg(id), '{}') into v_orders
  from public.orders
  where user_id = p_user
     or (user_id is null and v_email is not null and lower(email_cliente) = lower(v_email));

  delete from private.stock_reservations where order_id = any(v_orders);
  delete from private.checkout_state where order_id = any(v_orders);

  update public.orders
     set user_id = null,
         nome_cliente = 'Cliente excluído',
         email_cliente = '',
         cpf_cliente = '',
         telefone_cliente = '',
         endereco = '{}'::jsonb
   where id = any(v_orders);
  get diagnostics v_order_count = row_count;

  update public.hub_orders set user_id = null where user_id = p_user;
  get diagnostics v_hub_count = row_count;

  delete from auth.users where id = p_user;

  return jsonb_build_object('ok', true, 'orders_anonymized', v_order_count, 'hub_orders_unlinked', v_hub_count);
end;
$$;

revoke all on function public.triade_delete_account(uuid) from public, anon, authenticated;
grant execute on function public.triade_delete_account(uuid) to service_role;
notify pgrst, 'reload schema';
