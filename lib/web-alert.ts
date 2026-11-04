import { Alert, Platform, type AlertButton } from 'react-native';

/**
 * React Native Web'de Alert.alert hiçbir şey yapmaz: hata ve onay mesajları sessizce kaybolur.
 * Web'de tarayıcının kendi pencereleriyle çalışır.
 */
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title: string, message?: string, buttons?: AlertButton[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = buttons ?? [];
    if (list.length < 2) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    const cancel = list.find(b => b.style === 'cancel');
    const action = list.find(b => b !== cancel) ?? list[0];
    if (window.confirm(text)) action.onPress?.();
    else cancel?.onPress?.();
  };
}
