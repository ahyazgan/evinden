import * as WebBrowser from 'expo-web-browser';
import { cancelOrder, fetchOrderPaymentStatus, startOnlinePayment } from './db';

const RETURN_URL = 'evinden://payment-result';
const STATUS_CHECKS = 6;
const STATUS_CHECK_MS = 1500;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * iyzico ödeme sayfasını açar, dönüşte sonucu sunucudan okur. Uygulamanın gördüğü yönlendirmeye
 * güvenilmez: ödeme yalnızca sunucu doğruladıysa başarılı sayılır. Ödenmezse sipariş iptal edilir;
 * iptalden sonra ödeme gelirse sunucu onu iade kuyruğuna alır.
 */
export async function payOrderOnline(orderId: string): Promise<boolean> {
  try {
    const url = await startOnlinePayment(orderId);
    await WebBrowser.openAuthSessionAsync(url, RETURN_URL);
    for (let i = 0; i < STATUS_CHECKS; i++) {
      if ((await fetchOrderPaymentStatus(orderId)) === 'paid') return true;
      await wait(STATUS_CHECK_MS);
    }
  } catch (e) {
    console.warn('[payment]', e);
  }
  // Başarısız iptalde sipariş süre dolunca sunucuda iptal olur.
  await cancelOrder(orderId).catch(() => undefined);
  return false;
}
