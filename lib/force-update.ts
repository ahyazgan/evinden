import { Alert, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const APP_STORE_URL = 'https://apps.apple.com/app/evinden/id0000000000';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.evinden.app';

type UpdateConfig = {
  min_version: string;
  latest_version: string;
  force_update: boolean;
  update_message: string;
};

/** Sürüm karşılaştırması: "1.2.3" > "1.2.0" */
function isVersionLower(current: string, required: string): boolean {
  const c = current.split('.').map(Number);
  const r = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] ?? 0) < (r[i] ?? 0)) return true;
    if ((c[i] ?? 0) > (r[i] ?? 0)) return false;
  }
  return false;
}

/** Güncelleme kontrolü — app açılışında çağır */
export async function checkForUpdate(): Promise<void> {
  try {
    const currentVersion = Constants.expoConfig?.version ?? '1.0.0';

    // Try to get update config from Supabase
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'update_config')
      .single();

    if (error || !data) return;

    const config: UpdateConfig = typeof data.value === 'string'
      ? JSON.parse(data.value)
      : data.value;

    if (!isVersionLower(currentVersion, config.min_version)) return;

    const storeUrl = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
    const message = config.update_message || 'Daha iyi bir deneyim için uygulamayı güncellemeniz gerekiyor.';

    if (config.force_update) {
      // Force update — no dismiss option
      Alert.alert(
        'Güncelleme Gerekli',
        message,
        [
          {
            text: 'Güncelle',
            onPress: () => Linking.openURL(storeUrl),
          },
        ],
        { cancelable: false },
      );
    } else {
      // Optional update
      Alert.alert(
        'Güncelleme Mevcut',
        message,
        [
          { text: 'Sonra', style: 'cancel' },
          {
            text: 'Güncelle',
            onPress: () => Linking.openURL(storeUrl),
          },
        ],
      );
    }
  } catch {
    // Silent fail — update check is non-critical
  }
}
