import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = '@evinden_push_token';

// ─── Configuration ───────────────────────────────────────────────────────────

// Set default notification behavior (show even when app is foreground)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Registration ────────────────────────────────────────────────────────────

export async function registerForPushNotifications(): Promise<string | null> {
  // Check if physical device
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  // Check/request permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return null;
  }

  // Android channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Sipariş Bildirimleri',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E8593E',
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('promos', {
      name: 'Kampanya Bildirimleri',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: 'default',
    });

    await Notifications.setNotificationChannelAsync('system', {
      name: 'Sistem Bildirimleri',
      importance: Notifications.AndroidImportance.LOW,
    });
  }

  // Get push token
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: undefined, // Will use app.json config
    });
    const token = tokenData.data;
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.log('Failed to get push token:', e);
    return null;
  }
}

export async function getSavedPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

// ─── Local Notifications ─────────────────────────────────────────────────────

export type NotificationType = 'order_status' | 'promo' | 'seller_update' | 'system';

export async function sendLocalNotification(
  title: string,
  body: string,
  type: NotificationType = 'system',
  data?: Record<string, string>,
): Promise<void> {
  const channelId = type === 'order_status' ? 'orders' : type === 'promo' ? 'promos' : 'system';

  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { type, ...data },
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: null, // immediate
  });
}

// ─── Pre-built notification templates ────────────────────────────────────────

export async function notifyOrderAccepted(orderId: string, sellerName: string): Promise<void> {
  await sendLocalNotification(
    'Sipariş Kabul Edildi ✅',
    `${sellerName} siparişinizi kabul etti. Hazırlanmaya başlandı!`,
    'order_status',
    { orderId },
  );
}

export async function notifyOrderPreparing(orderId: string, sellerName: string): Promise<void> {
  await sendLocalNotification(
    'Siparişiniz Hazırlanıyor 🍳',
    `${sellerName} siparişinizi hazırlıyor.`,
    'order_status',
    { orderId },
  );
}

export async function notifyOrderReady(orderId: string, sellerName: string): Promise<void> {
  await sendLocalNotification(
    'Siparişiniz Hazır! 🎉',
    `${sellerName} siparişinizi hazırladı. Kurye yola çıktı!`,
    'order_status',
    { orderId },
  );
}

export async function notifyOrderDelivered(orderId: string): Promise<void> {
  await sendLocalNotification(
    'Teslim Edildi 📦',
    'Siparişiniz teslim edildi. Afiyet olsun! Değerlendirme yapmayı unutmayın.',
    'order_status',
    { orderId },
  );
}

export async function notifyPromo(title: string, message: string, couponCode?: string): Promise<void> {
  await sendLocalNotification(
    title,
    message,
    'promo',
    couponCode ? { couponCode } : undefined,
  );
}

export async function notifySellerMenuUpdate(sellerName: string): Promise<void> {
  await sendLocalNotification(
    'Menü Güncellendi 🍽️',
    `${sellerName} yeni ürünler ekledi. Şimdi göz at!`,
    'seller_update',
  );
}

// ─── Notification listeners ──────────────────────────────────────────────────

export function addNotificationReceivedListener(
  callback: (notification: Notifications.Notification) => void,
): Notifications.Subscription {
  return Notifications.addNotificationReceivedListener(callback);
}

export function addNotificationResponseListener(
  callback: (response: Notifications.NotificationResponse) => void,
): Notifications.Subscription {
  return Notifications.addNotificationResponseReceivedListener(callback);
}

// ─── Badge ───────────────────────────────────────────────────────────────────

export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}

export async function clearBadge(): Promise<void> {
  await Notifications.setBadgeCountAsync(0);
}
