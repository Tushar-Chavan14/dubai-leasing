import type { Metadata } from "next";
import { Chat } from "../../../components/customer-chat/chat";

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage() {
  return (
    <div className="pub-wrap pub-chatpage">
      <h1 className="pub-h">Chat with us</h1>
      <div className="pub-chatframe">
        <Chat />
      </div>
    </div>
  );
}
