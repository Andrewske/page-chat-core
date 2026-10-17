/* Browser API. Server and runner code imports 'page-chat-core/protocol' (types and
   constants, no React) or 'page-chat-core/chat-view' (pure event folding). */
export * from './protocol'
export * from './chat-view'
export { createPageChatClient, errorStatus, pageChatUrls, sendForm } from './client'
export type { FetchFn, PageChatClient, PageChatClientOptions, PageChatUrls, SendMessageInput } from './client'
export { PageChatProvider, pageChatKeys, usePageChat, usePageChatClient, usePageChatHistory } from './use-page-chat'
export type { PageChatProviderProps, UsePageChat, UsePageChatOptions } from './use-page-chat'
export { collectPageContext, listenForPageErrors } from './page-context'
export { CAPTURE_EXCLUDE_ATTR, captureVisible } from './page-capture'
export type { CaptureMime } from './page-capture'
