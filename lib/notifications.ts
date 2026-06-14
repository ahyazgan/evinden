import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PUSH_TOKEN_KEY = '@evinden_push_token';

// Configure how notifications appear when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Register for push notifications and return the Expo push token.
 * Returns null if permissions are denied or device is not physical.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications don't work on simulators
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  // Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Varsayılan',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E8593E',
    });

    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Sipariş Bildirimleri',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#E8593E',
    });

    await Notifications.setNotificationChannelAsync('promos', {
      name: 'Kampanya Bildirimleri',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // Save locally
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

  return token;
}

/** Get the saved push token (if any) */
export async function getSavedPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/** Schedule a local notification (useful for order status updates in demo mode) */
export async function sendLocalNotification(
  title: string,
  body: string,
  channelId: string = 'default',
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: null, // immediate
  });
}

/** Schedule a delayed local notification */
export async function scheduleNotification(
  title: string,
  body: string,
  delaySeconds: number,
  channelId: string = 'default',
) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId } : {}),
    },
    trigger: { seconds: delaySeconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
  });
}

/** Get the badge count */
export async function getBadgeCount(): Promise<number> {
  return Notifications.getBadgeCountAsync();
}

/** Set the badge count */
export async function setBadgeCount(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(count);
}
