import type { Metadata } from "next";
import { CustomerChat } from "../../../components/customer-chat/customer-chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ searchParams }: PageProps<"/customer/chat">) {
  const { unit } = await searchParams;
  const id = Array.isArray(unit) ? unit[0] : unit;
  return (
    <div className="pub-wrap pub-chatpage">
      <h1 className="pub-h">Chat with us</h1>
      <div className="pub-chatframe">
        <CustomerChat {...(id && /^[0-9a-f-]{36}$/i.test(id) ? { unitId: id } : {})} />
      </div>
    </div>
  );
}
