// Zamanlanmış görev çağırır (023). JWT yerine paylaşılan gizli değerle doğrulanır.
import { deps, json, validCronSecret } from '../_shared/deps.ts';
import { handleReconcile } from '../_shared/handlers.ts';

Deno.serve(async req => {
  if (!(await validCronSecret(req))) {
    return json(401, { error: 'Yetkisiz' });
  }
  try {
    return json(200, await handleReconcile(deps));
  } catch (e) {
    console.error('payment-reconcile', e);
    return json(500, { error: 'Mutabakat çalışmadı' });
  }
});
