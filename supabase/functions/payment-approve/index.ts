// Zamanlanmış görev çağırır (036). JWT yerine paylaşılan gizli değerle doğrulanır.
import { deps, json, validCronSecret } from '../_shared/deps.ts';
import { handleApprovals } from '../_shared/handlers.ts';

Deno.serve(async req => {
  if (!(await validCronSecret(req))) {
    return json(401, { error: 'Yetkisiz' });
  }
  try {
    return json(200, await handleApprovals(deps));
  } catch (e) {
    console.error('payment-approve', e instanceof Error ? e.message : 'bilinmeyen hata');
    return json(500, { error: 'Onaylar işlenemedi' });
  }
});
