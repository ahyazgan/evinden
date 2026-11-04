// Zamanlanmış görev çağırır (036). JWT yerine paylaşılan gizli değerle doğrulanır.
import { deps, json } from '../_shared/deps.ts';
import { handleApprovals } from '../_shared/handlers.ts';

Deno.serve(async req => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return json(401, { error: 'Yetkisiz' });
  }
  try {
    return json(200, await handleApprovals(deps));
  } catch (e) {
    console.error('payment-approve', e instanceof Error ? e.message : 'bilinmeyen hata');
    return json(500, { error: 'Onaylar işlenemedi' });
  }
});
