# POS bağlantısı

Restoran, Afiyetli siparişlerini kendi kasa sistemine (POS) ya da yazılımına otomatik aktarabilir. Restoran bağlantıyı **Restoran paneli → POS bağlantısı** ekranından açar. Bu not, bağlantıyı kuracak POS firması veya yazılımcı içindir.

## 1. Sipariş bildirimi (Afiyetli → POS)

Restoranın yazdığı HTTPS adresine `POST` isteği gider. Gövde JSON'dur:

```json
{
  "event": "order.created",
  "sent_at": "2026-11-07T12:00:00+00:00",
  "data": {
    "id": "8f1c…", "code": "8F1C2A3B", "status": "pending",
    "fulfillment": "delivery", "scheduled_for": null, "created_at": "…",
    "customer_name": "Ayşe", "delivery_address": "…", "notes": "…",
    "payment_method": "cash", "currency": "TRY",
    "subtotal_cents": 25000, "delivery_fee_cents": 1500, "discount_cents": 0, "tip_cents": 0, "total_cents": 26500,
    "prep_minutes": null, "cancel_reason": null,
    "items": [{ "menu_item_id": "…", "title": "Adana kebap", "quantity": 2, "unit_price_cents": 12500, "line_total_cents": 25000 }]
  }
}
```

Olaylar:

| `event` | Ne zaman |
|---|---|
| `order.created` | Sipariş restorana düştü (kapıda ödemede hemen, online ödemede ödeme onaylanınca) |
| `order.status_changed` | Durum değişti: `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `cancelled` |
| `ping` | Restoran "Deneme gönder"e bastı |

Tutarlar kuruş cinsindendir. Telefon numarası gönderilmez.

### İmza doğrulama

Her istekte şu başlıklar bulunur:

- `X-Afiyetli-Event`: olay adı
- `X-Afiyetli-Timestamp`: Unix saniyesi
- `X-Afiyetli-Signature`: `sha256=<hex>`

İmza, `whsec_` ile başlayan **imza anahtarıyla** hesaplanan `HMAC-SHA256(timestamp + "." + ham_gövde)` değeridir. Gövdeyi ayrıştırmadan önce ham metin üzerinden doğrula ve 5 dakikadan eski zaman damgalarını reddet.

```js
const crypto = require('crypto');
function verify(rawBody, headers, secret) {
  const ts = headers['x-afiyetli-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const got = headers['x-afiyetli-signature'] ?? '';
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

Gönderim bir kez yapılır, 5 saniye içinde yanıt beklenir ve tekrar denenmez. 2xx dışındaki yanıtlar restoranın ekranında "Hata" olarak görünür. Aynı olay iki kez gelebileceği için sipariş `id` ve `status` ile tekilleştir.

## 2. Menü ve "bitti" eşitlemesi (POS → Afiyetli)

İstekler Supabase REST adresine gider. `apikey` başlığına uygulamanın herkese açık anahtarı (anon key) yazılır; restoranın kimliği gövdedeki **API anahtarıdır** (`afy_` ile başlar).

**Menüyü okuma:**

```bash
curl -X POST "https://<proje>.supabase.co/rest/v1/rpc/pos_menu" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"p_api_key":"afy_…"}'
```

Yanıt: `[{ "id", "title", "price_cents", "is_available", "daily_limit", "sold_today" }]`. POS'taki ürünleri bu `id` ile eşleştir.

**Ürünü bitti yapma ya da günlük adet verme:**

```bash
curl -X POST "https://<proje>.supabase.co/rest/v1/rpc/pos_set_availability" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"p_api_key":"afy_…","p_items":[{"id":"…","available":false},{"id":"…","daily_limit":20}]}'
```

- `available`: `true` ya da `false`
- `daily_limit`: günlük adet, `0` sınırsız demektir
- Tek istekte en çok 200 satır gönderilebilir.

Yanıt `{ "updated": 2, "unknown": 0 }` biçimindedir. `unknown`, restorana ait olmayan ya da hatalı kimlikleri sayar.

Fiyat ve ürün adı POS'tan değiştirilemez; bunlar Afiyetli'deki menü ekranından yönetilir.

## 3. Güvenlik

- İmza anahtarı ve API anahtarı yalnızca oluşturulduğunda bir kez gösterilir. Kaybolursa restoran ekranından **Anahtarları yenile** ile yenisi alınır; eskiler hemen geçersiz olur.
- Bağlantı kapatıldığında sipariş gönderimi durur ve API anahtarı çalışmaz.
- Bildirim adresi `https://` ile başlamalıdır. IP adresi, özel port, `localhost` ve iç ağ adları kabul edilmez.
