import { admin, authenticatedUserId, clientIp, corsHeaders, deps, json } from '../_shared/deps.ts';
import { handleRefund } from '../_shared/handlers.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await authenticatedUserId(req);
    if (!userId) return json(401, { error: 'Giriş yapmalısınız' });
    const { data: profile } = await admin.from('users').select('role').eq('id', userId).maybeSingle();
    const { orderId } = await req.json();
    const { status, body } = await handleRefund(profile?.role === 'admin', orderId, clientIp(req), deps);
    return json(status, body);
  } catch (e) {
    console.error('payment-refund', e);
    return json(500, { error: 'İade yapılamadı' });
  }
});
