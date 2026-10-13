import { afterEach, expect, test } from 'bun:test'

import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

import { createCanvasHost } from '../canvas-host'

const bundle: AuthBundle = {
  access_token: 'token-a',
  token_type: 'Bearer',
  access_expires_at: 4102444800,
  user: { id: 42, username: 'a', role: 1 },
  session: {
    sid: 'session-a',
    current: true,
    login_method: 'password',
    ip: '',
    user_agent: '',
    created_at: 1,
    last_active_at: 1,
    expires_at: 4102444800,
  },
}
afterEach(() => useAuthStore.getState().auth.reset('complete'))

test('宿主只返回当前会话身份和有效认证头', async () => {
  useAuthStore.getState().auth.setBundle(bundle)
  const host = createCanvasHost()
  expect(host.getUser()).toEqual({
    id: '42',
    username: 'a',
    displayName: undefined,
  })
  expect(await host.getAuthHeaders()).toEqual({
    Authorization: 'Bearer token-a',
  })
})

test('退出后旧宿主失效并通知子应用', async () => {
  useAuthStore.getState().auth.setBundle(bundle)
  const host = createCanvasHost()
  let invalidated = false
  const unsubscribe = host.subscribe(() => {
    invalidated = true
  })
  useAuthStore.getState().auth.reset('complete')
  expect(invalidated).toBe(true)
  expect(host.getUser()).toBeNull()
  await expect(host.getAuthHeaders()).rejects.toThrow()
  unsubscribe()
})

test('等待认证头期间换账号时拒绝晚到凭据', async () => {
  useAuthStore.getState().auth.setBundle(bundle)
  const host = createCanvasHost()
  const pending = host.getAuthHeaders()
  useAuthStore
    .getState()
    .auth.setBundle({
      ...bundle,
      user: { ...bundle.user, id: 43 },
      session: { ...bundle.session, sid: 'session-b' },
    })
  await expect(pending).rejects.toThrow()
})

test('同一会话刷新 Token 后旧宿主读取最新 Token，不重新绑定身份', async () => {
  useAuthStore.getState().auth.setBundle(bundle)
  const host = createCanvasHost()
  useAuthStore
    .getState()
    .auth.setBundle({ ...bundle, access_token: 'rotated-token' })
  expect(await host.getAuthHeaders()).toEqual({
    Authorization: 'Bearer rotated-token',
  })
})

test('换账号后旧宿主不能取得新账号凭据', async () => {
  useAuthStore.getState().auth.setBundle(bundle)
  const host = createCanvasHost()
  useAuthStore
    .getState()
    .auth.setBundle({
      ...bundle,
      user: { ...bundle.user, id: 43 },
      session: { ...bundle.session, sid: 'session-b' },
    })
  expect(host.getUser()).toBeNull()
  await expect(host.getAuthHeaders()).rejects.toThrow()
})
