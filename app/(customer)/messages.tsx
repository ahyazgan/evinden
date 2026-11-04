import { ConversationList } from '@/components/shared/ConversationList';

export default function CustomerMessagesScreen() {
  return <ConversationList role="customer" emptyText="Henüz mesajınız yok. Satıcı sayfasından soru sorabilirsiniz." />;
}
