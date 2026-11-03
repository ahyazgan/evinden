import { authenticatedUserId, clientIp, corsHeaders, deps, json } from '../_shared/deps.ts';
import { handleInit } from '../_shared/handlers.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await authenticatedUserId(req);
    if (!userId) return json(401, { error: 'Giriş yapmalısınız' });
    const { orderId } = await req.json();
    const { status, body } = await handleInit(userId, orderId, clientIp(req), deps);
    return json(status, body);
  } catch (e) {
    console.error('payment-init', e);
    return json(500, { error: 'Ödeme başlatılamadı' });
  }
});
