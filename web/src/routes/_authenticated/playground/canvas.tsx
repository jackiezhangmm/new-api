import { createFileRoute, redirect } from '@tanstack/react-router'
import { useLayoutEffect, useState } from 'react'

import {
  createCanvasHost,
  type CanvasHost,
} from '@/features/canvas/canvas-host'
import { isSidebarModuleEnabled } from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export const Route = createFileRoute('/_authenticated/playground/canvas')({
  beforeLoad: async () => {
    if (!isSidebarModuleEnabled('chat', 'canvas')) {
      throw redirect({ to: '/dashboard' })
    }
  },
  component: CanvasPage,
})

function CanvasPage() {
  const auth = useAuthStore((state) => state.auth)

  const sessionKey = `${auth.user?.id ?? ''}:${auth.session?.sid ?? ''}`
  const [readySession, setReadySession] = useState<string | null>(null)

  useLayoutEffect(() => {
    const hostWindow = window as Window & { newApiCanvasHost?: CanvasHost }
    const host = createCanvasHost()
    hostWindow.newApiCanvasHost = host
    setReadySession(host.getUser() ? sessionKey : null)
    return () => {
      if (hostWindow.newApiCanvasHost === host) {
        delete hostWindow.newApiCanvasHost
      }
    }
  }, [sessionKey])

  if (!auth.user || !auth.accessToken || readySession !== sessionKey) {
    return null
  }

  // 同域受信任子应用需要直接读取宿主接口；不把 iframe 当作安全隔离。
  return (
    // oxlint-disable-next-line react/iframe-missing-sandbox
    <iframe
      key={sessionKey}
      title='Infinite Canvas'
      src='/canvas/'
      className='h-full w-full border-0'
      loading='eager'
      allow='clipboard-read; clipboard-write'
    />
  )
}
