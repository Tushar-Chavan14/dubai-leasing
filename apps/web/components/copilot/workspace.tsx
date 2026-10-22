"use client";

import { useCallback } from "react";
import { CopilotChat } from "./chat";
import type { ChatMessage } from "./use-chat";

/**
 * Full-page chat. A new conversation gets its own URL (so reload and the list find it) without
 * a server refresh, which would remount the chat while an answer is streaming.
 */
export function CopilotWorkspace({ threadId, initial }: { threadId?: string; initial?: ChatMessage[] }) {
  const onThread = useCallback(
    (id: string) => {
      if (id !== threadId) window.history.replaceState(null, "", `/copilot?thread=${id}`);
    },
    [threadId],
  );
  return (
    <CopilotChat {...(threadId ? { threadId } : {})} {...(initial ? { initial } : {})} autoFocus onThread={onThread} />
  );
}
