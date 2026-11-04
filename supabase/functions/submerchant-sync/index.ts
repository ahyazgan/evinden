// Yönetici satıcıyı iyzico'ya alt üye olarak kaydeder veya günceller. IBAN ve kimlik bilgileri günlüğe yazılmaz.
import { admin, authenticatedUserId, corsHeaders, deps, json } from '../_shared/deps.ts';
import { handleSubmerchantSync } from '../_shared/handlers.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await authenticatedUserId(req);
    if (!userId) return json(401, { error: 'Giriş yapmalısınız' });
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle();
    const { sellerId } = await req.json();
    const { status, body } = await handleSubmerchantSync(profile?.role === 'admin', sellerId, deps);
    return json(status, body);
  } catch (e) {
    console.error('submerchant-sync', e instanceof Error ? e.message : 'bilinmeyen hata');
    return json(500, { error: 'Kayıt yapılamadı' });
  }
});
