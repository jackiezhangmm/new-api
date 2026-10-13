import { t } from 'i18next'

import { getFreshAuthHeaders } from '@/lib/auth-session'
import { useAuthStore } from '@/stores/auth-store'

export type CanvasHost = ReturnType<typeof createCanvasHost>

export function createCanvasHost() {
  const initial = useAuthStore.getState().auth
  let invalidated = false
  const getUser = () => {
    const auth = useAuthStore.getState().auth
    if (
      invalidated ||
      !initial.user ||
      !initial.session ||
      !auth.accessToken ||
      auth.user?.id !== initial.user.id ||
      auth.session?.sid !== initial.session.sid
    ) {
      invalidated = true
      return null
    }
    return {
      id: String(auth.user.id),
      username: auth.user.username,
      displayName: auth.user.display_name,
    }
  }
  return {
    getUser,
    async getAuthHeaders(): Promise<Record<string, string>> {
      if (!getUser()) throw new Error(t('Session expired!'))
      const headers = await getFreshAuthHeaders()
      // 刷新等待期间可能退出或切换账号，不能把新会话凭据交给旧画布。
      if (!getUser() || !headers.Authorization) {
        throw new Error(t('Session expired!'))
      }
      return { Authorization: headers.Authorization }
    },
    subscribe(listener: () => void) {
      return useAuthStore.subscribe(() => {
        if (!getUser()) listener()
      })
    },
  }
}
