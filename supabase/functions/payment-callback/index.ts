// iyzico ödeme bittiğinde buraya token gönderir, ardından müşteri uygulamaya döner.
// JWT doğrulaması kapalıdır (config.toml): isteği iyzico yapar, sonuç sunucudan yeniden sorgulanır.
import { deps } from '../_shared/deps.ts';
import { handleCallback } from '../_shared/handlers.ts';

const redirect = (status: string) =>
  new Response(null, { status: 302, headers: { Location: `afiyetli://payment-result?status=${status}` } });

Deno.serve(async req => {
  try {
    const form = await req.formData();
    return redirect(await handleCallback(form.get('token'), deps));
  } catch (e) {
    console.error('payment-callback', e);
    return redirect('failed');
  }
});
