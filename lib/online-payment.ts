import * as WebBrowser from 'expo-web-browser';
import { cancelUnpaidOrder, fetchOrderPaymentStatus, startOnlinePayment } from './db';

const RETURN_URL = 'evinden://payment-result';
const STATUS_CHECKS = 6;
const STATUS_CHECK_MS = 1500;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readStatus(orderId: string): Promise<string | null> {
  try {
    return await fetchOrderPaymentStatus(orderId);
  } catch {
    return null;
  }
}

export type PaymentOutcome = 'paid' | 'not_paid' | 'unknown';

/**
 * iyzico ödeme sayfasını açar, dönüşte sonucu sunucudan okur. Uygulamanın gördüğü yönlendirmeye
 * güvenilmez. Sonuç üçe ayrılır, çünkü "çekim yapılmadı" ancak sunucu doğrulayınca söylenebilir:
 * paid: ödeme doğrulandı. not_paid: sipariş iptal edildi. unknown: bağlantı yok, sonuç görülemedi.
 * Sipariş burada iptal edilse bile ödeme sonradan bulunursa sunucu parayı iade kuyruğuna alır.
 */
export async function payOrderOnline(orderId: string): Promise<PaymentOutcome> {
  let url: string;
  try {
    url = await startOnlinePayment(orderId);
  } catch {
    // Ödeme sayfası hiç açılmadı: çekim yapılmış olamaz.
    await cancelUnpaidOrder(orderId).catch(() => undefined);
    return 'not_paid';
  }

  await WebBrowser.openAuthSessionAsync(url, RETURN_URL).catch(() => undefined);

  for (let i = 0; i < STATUS_CHECKS; i++) {
    if ((await readStatus(orderId)) === 'paid') return 'paid';
    await wait(STATUS_CHECK_MS);
  }

  // Yalnızca hâlâ ödeme bekleyen sipariş iptal edilir; son durum yeniden okunur.
  await cancelUnpaidOrder(orderId).catch(() => undefined);
  const finalStatus = await readStatus(orderId);
  if (finalStatus === 'paid') return 'paid';
  return finalStatus === null ? 'unknown' : 'not_paid';
}
