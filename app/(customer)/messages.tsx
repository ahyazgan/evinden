import { ConversationList } from '@/components/shared/ConversationList';

export default function CustomerMessagesScreen() {
  return <ConversationList role="customer" emptyText="Henüz mesajın yok. Satıcı sayfasından soru sorabilirsin." />;
}
