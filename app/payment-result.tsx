import { Redirect } from 'expo-router';

// Ödeme sayfasından dönüş bağlantısı. Sonucu ekran değil sunucu belirler (lib/online-payment.ts).
export default function PaymentResult() {
  return <Redirect href="/(customer)/orders" />;
}
