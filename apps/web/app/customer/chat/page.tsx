import { SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { CustomerChat } from "../../../components/customer-chat/customer-chat";

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({ searchParams }: PageProps<"/customer/chat">) {
  const { unit, check } = await searchParams;
  const id = Array.isArray(unit) ? unit[0] : unit;
  return (
    <div
      data-fit-screen
      className="mx-auto flex min-h-0 w-full max-w-[820px] flex-1 flex-col px-4 py-4 md:px-8 md:py-6"
    >
      <div className="flex min-h-0 w-full max-h-[820px] flex-1 flex-col overflow-hidden rounded-[22px] border border-line bg-page">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span
            className="grid size-9 flex-none place-items-center rounded-[10px] bg-accent text-on-accent"
            aria-hidden="true"
          >
            <SparkleIcon size={18} weight="bold" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-xl leading-tight font-semibold tracking-tight">Ask about a home</h1>
            <p className="m-0 text-[13px] text-muted">Replies in seconds. Ask in English or Arabic.</p>
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <CustomerChat
            {...(id && /^[0-9a-f-]{36}$/i.test(id) ? { unitId: id } : {})}
            {...(check !== undefined ? { check: true } : {})}
          />
        </div>
      </div>
    </div>
  );
}
