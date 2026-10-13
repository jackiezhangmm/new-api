/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'

import { Window } from 'happy-dom'

import { api } from '@/lib/api'

const bunTestModule = 'bun:test'
const { afterEach, beforeEach, test } = (await import(bunTestModule)) as {
  afterEach: typeof import('node:test').afterEach
  beforeEach: typeof import('node:test').beforeEach
  test: typeof import('node:test').test
}

const domWindow = new Window()
domWindow.document.insertBefore(
  domWindow.document.implementation.createDocumentType('html', '', ''),
  domWindow.document.documentElement
)
Object.defineProperty(domWindow.document, 'compatMode', { value: 'CSS1Compat' })
const domGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'HTMLButtonElement',
  'HTMLInputElement',
  'HTMLTextAreaElement',
  'HTMLImageElement',
  'SVGElement',
  'Node',
  'Element',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
] as const
for (const key of domGlobals) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: domWindow[key],
  })
}
Object.defineProperty(domWindow.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async () => undefined },
})
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { waitFor } = await import('@testing-library/react')
const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { DigitalAssets } = await import('../index')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
  returnNull: false,
})

type ApiClient = {
  get: (
    url: string,
    config?: { params?: Record<string, unknown> }
  ) => Promise<{ data: unknown }>
  post: (url: string, data?: unknown) => Promise<{ data: unknown }>
  put: (url: string, data?: unknown) => Promise<{ data: unknown }>
  patch: (url: string, data?: unknown) => Promise<{ data: unknown }>
  delete: (url: string) => Promise<{ data: unknown }>
}

const client = api as unknown as ApiClient
const originals = {
  get: client.get,
  post: client.post,
  put: client.put,
  patch: client.patch,
  delete: client.delete,
}
const getCalls: { url: string; params?: Record<string, unknown> }[] = []
const patchCalls: { url: string; data: unknown }[] = []

const asset = {
  id: 7,
  user_id: 1,
  asset_type: 'text' as const,
  title: 'Portrait prompt',
  content: 'Create a detailed portrait',
  is_favorite: true,
  created_at: 10,
  updated_at: 20,
  tags: [{ id: 3, user_id: 1, name: '角色', created_at: 10, updated_at: 10 }],
}

async function flushQueries(queryClient: InstanceType<typeof QueryClient>) {
  await act(async () => {
    while (queryClient.isFetching() > 0) {
      await Promise.all(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.promise)
      )
    }
  })
}

async function renderPage() {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <DigitalAssets />
        </I18nextProvider>
      </QueryClientProvider>
    )
  })
  await act(async () => {
    await queryClient.refetchQueries()
  })
  return { container, root, queryClient }
}

beforeEach(() => {
  document.body.replaceChildren()
  getCalls.length = 0
  patchCalls.length = 0
  client.get = async (url, config) => {
    getCalls.push({ url, params: config?.params })
    if (url.endsWith('/tags')) {
      return { data: { success: true, message: '', data: asset.tags } }
    }
    const favorite = config?.params?.favorite === true
    return {
      data: {
        success: true,
        message: '',
        data: {
          page: config?.params?.p ?? 1,
          page_size: config?.params?.page_size,
          total: 1,
          items: favorite ? [asset] : [asset],
        },
      },
    }
  }
  client.patch = async (url, data) => {
    patchCalls.push({ url, data })
    return {
      data: {
        success: true,
        message: '',
        data: { ...asset, is_favorite: false },
      },
    }
  }
  client.post = async () => ({
    data: { success: true, message: '', data: asset },
  })
  client.put = async () => ({
    data: { success: true, message: '', data: asset },
  })
  client.delete = async () => ({
    data: { success: true, message: '', data: null },
  })
})

afterEach(() => {
  client.get = originals.get
  client.post = originals.post
  client.put = originals.put
  client.patch = originals.patch
  client.delete = originals.delete
})

test('favorites and all assets use independent list contracts while search only filters all assets', async () => {
  const rendered = await renderPage()
  const listCalls = getCalls.filter(
    (call) => call.url === '/api/digital-assets/'
  )
  assert.ok(listCalls.length >= 2)
  assert.ok(
    listCalls.some(
      (call) => call.params?.favorite === true && call.params?.page_size === 6
    )
  )
  assert.ok(
    listCalls.some(
      (call) =>
        call.params?.favorite === undefined && call.params?.page_size === 12
    )
  )

  const search = rendered.container.querySelector(
    '[aria-label="Search assets"]'
  )
  assert.ok(search instanceof HTMLInputElement)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setter)
    setter.call(search, 'portrait')
    search.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flushQueries(rendered.queryClient)

  const searchedCalls = getCalls.filter(
    (call) =>
      call.url === '/api/digital-assets/' && call.params?.search === 'portrait'
  )
  assert.equal(searchedCalls.length, 1)
  assert.equal(searchedCalls[0]?.params?.favorite, undefined)

  const openButton = rendered.container.querySelector(
    '[aria-label="Open prompt Portrait prompt"]'
  )
  assert.ok(openButton instanceof HTMLButtonElement)
  await act(async () => openButton.click())
  assert.match(document.body.textContent ?? '', /Create a detailed portrait/)

  const favoriteButton = [...document.body.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('Remove from favorites')
  )
  assert.ok(favoriteButton instanceof HTMLButtonElement)
  await act(async () => favoriteButton.click())
  await flushQueries(rendered.queryClient)
  assert.equal(patchCalls.length, 1)
  assert.equal(patchCalls[0]?.url, '/api/digital-assets/7/favorite')
  assert.deepEqual(patchCalls[0]?.data, { is_favorite: false })

  await act(async () => rendered.root.unmount())
  rendered.queryClient.clear()
})

test('type pills filter assets by type and image asset displays thumbnail and dimensions', async () => {
  const imageAsset = {
    id: 8,
    user_id: 1,
    asset_type: 'image' as const,
    title: 'Scenic painting',
    content: 'A beautiful sunset over mountains',
    image_id: 'img-100',
    image: {
      id: 'img-100',
      url: 'https://example.com/sunset.png',
      width: 1920,
      height: 1080,
      mime_type: 'image/png',
    },
    is_favorite: false,
    created_at: 30,
    updated_at: 30,
    tags: [{ id: 4, user_id: 1, name: '风景', created_at: 30, updated_at: 30 }],
  }

  client.get = async (url, config) => {
    getCalls.push({ url, params: config?.params })
    if (url.endsWith('/tags')) {
      return {
        data: {
          success: true,
          message: '',
          data: [...asset.tags, ...imageAsset.tags],
        },
      }
    }
    const requestedType = config?.params?.asset_type
    const items =
      requestedType === 'image'
        ? [imageAsset]
        : requestedType === 'text'
          ? [asset]
          : [asset, imageAsset]
    return {
      data: {
        success: true,
        message: '',
        data: {
          page: config?.params?.p ?? 1,
          page_size: config?.params?.page_size,
          total: items.length,
          items,
        },
      },
    }
  }

  const rendered = await renderPage()

  const imagePill = [...rendered.container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === 'Image'
  )
  assert.ok(imagePill instanceof HTMLButtonElement)
  await act(async () => imagePill.click())
  await flushQueries(rendered.queryClient)

  const imageFilterCalls = getCalls.filter(
    (call) =>
      call.url === '/api/digital-assets/' && call.params?.asset_type === 'image'
  )
  assert.ok(imageFilterCalls.length >= 1)

  const imgElement = rendered.container.querySelector(
    'img[src="https://example.com/sunset.png"]'
  )
  assert.ok(imgElement instanceof HTMLImageElement)

  const openButton = rendered.container.querySelector(
    '[aria-label="Open image Scenic painting"]'
  )
  assert.ok(openButton instanceof HTMLButtonElement)
  await act(async () => openButton.click())

  assert.match(document.body.textContent ?? '', /1920 × 1080/)
  assert.doesNotMatch(
    document.body.textContent ?? '',
    /A beautiful sunset over mountains/
  )
  assert.match(document.body.textContent ?? '', /Copy image link/)
  assert.match(document.body.textContent ?? '', /View original image/)
  assert.doesNotMatch(document.body.textContent ?? '', /Go draw/)
  assert.doesNotMatch(document.body.textContent ?? '', /Copy prompt/)

  await act(async () => rendered.root.unmount())
  rendered.queryClient.clear()
})

test('new asset dialog retains title and tags across prompt and image tabs, hides content on image tab', async () => {
  const rendered = await renderPage()

  const newAssetButton = [
    ...rendered.container.querySelectorAll('button'),
  ].find((b) => b.textContent?.includes('New asset'))
  assert.ok(newAssetButton instanceof HTMLButtonElement)
  await act(async () => newAssetButton.click())

  assert.match(document.body.textContent ?? '', /New asset/)
  assert.match(document.body.textContent ?? '', /Prompt asset/)
  assert.match(document.body.textContent ?? '', /Image asset/)

  const contentTextarea = document.body.querySelector('textarea')
  assert.ok(contentTextarea instanceof HTMLTextAreaElement)

  const titleInput = document.body.querySelector(
    'input[placeholder="Give this asset a clear title"]'
  )
  assert.ok(titleInput instanceof HTMLInputElement)
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    assert.ok(setter)
    setter.call(titleInput, 'Cross-tab Title')
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
  })

  const tagButton = [...document.body.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === '角色'
  )
  assert.ok(tagButton instanceof HTMLButtonElement)
  await act(async () => tagButton.click())

  const imageTab = [
    ...document.body.querySelectorAll('[role="tab"], button'),
  ].find((b) => b.textContent?.trim() === 'Image asset')
  assert.ok(imageTab instanceof HTMLElement)
  await act(async () => imageTab.click())

  assert.equal(titleInput.value, 'Cross-tab Title')
  assert.match(document.body.textContent ?? '', /角色/)
  assert.equal(document.body.querySelector('textarea'), null)
  assert.match(document.body.textContent ?? '', /Click to upload image/)

  const promptTab = [
    ...document.body.querySelectorAll('[role="tab"], button'),
  ].find((b) => b.textContent?.trim() === 'Prompt asset')
  assert.ok(promptTab instanceof HTMLElement)
  await act(async () => promptTab.click())

  assert.equal(titleInput.value, 'Cross-tab Title')
  assert.match(document.body.textContent ?? '', /角色/)
  assert.ok(
    document.body.querySelector('textarea') instanceof HTMLTextAreaElement
  )
  assert.match(document.body.textContent ?? '', /Upload reference image/)

  await act(async () => rendered.root.unmount())
  rendered.queryClient.clear()
})

test('gallery renders multi-state cards: pure text, prompt with reference image, and cover image asset', async () => {
  const textPrompt = {
    id: 10,
    user_id: 1,
    asset_type: 'text' as const,
    title: 'Pure text prompt',
    content: 'Pure text content without any image',
    is_favorite: false,
    created_at: 10,
    updated_at: 10,
    tags: [
      { id: 1, user_id: 1, name: '纯文本', created_at: 10, updated_at: 10 },
    ],
  }
  const promptWithRef = {
    id: 11,
    user_id: 1,
    asset_type: 'text' as const,
    title: 'Prompt with ref image',
    content: 'Prompt with reference image content',
    image_id: 'ref-img-1',
    image: {
      id: 'ref-img-1',
      url: 'https://example.com/ref.png',
      width: 1280,
      height: 720,
      mime_type: 'image/png',
    },
    is_favorite: true,
    created_at: 11,
    updated_at: 11,
    tags: [
      { id: 2, user_id: 1, name: '参考', created_at: 11, updated_at: 11 },
    ],
  }
  const pureImage = {
    id: 12,
    user_id: 1,
    asset_type: 'image' as const,
    title: 'Pure image asset',
    content: '',
    image_id: 'pure-img-1',
    image: {
      id: 'pure-img-1',
      url: 'https://example.com/pure.png',
      width: 800,
      height: 600,
      mime_type: 'image/png',
    },
    is_favorite: false,
    created_at: 12,
    updated_at: 12,
    tags: [
      { id: 3, user_id: 1, name: '插画', created_at: 12, updated_at: 12 },
    ],
  }

  client.get = async (url) => {
    if (url.endsWith('/tags')) {
      return { data: { success: true, message: '', data: [] } }
    }
    return {
      data: {
        success: true,
        message: '',
        data: {
          page: 1,
          page_size: 12,
          total: 3,
          items: [textPrompt, promptWithRef, pureImage],
        },
      },
    }
  }

  const rendered = await renderPage()

  await waitFor(() => {
    assert.match(document.body.textContent ?? '', /Pure text prompt/)
  })
  assert.match(
    document.body.textContent ?? '',
    /Pure text content without any image/
  )

  const refImg = rendered.container.querySelector(
    'img[src="https://example.com/ref.png"]'
  )
  assert.ok(refImg instanceof HTMLImageElement)
  assert.match(document.body.textContent ?? '', /Prompt with ref image/)
  assert.match(
    document.body.textContent ?? '',
    /Prompt with reference image content/
  )

  const pureImg = rendered.container.querySelector(
    'img[src="https://example.com/pure.png"]'
  )
  assert.ok(pureImg instanceof HTMLImageElement)
  assert.match(document.body.textContent ?? '', /Pure image asset/)

  const openRefPrompt = rendered.container.querySelector(
    '[aria-label="Open prompt Prompt with ref image"]'
  )
  assert.ok(openRefPrompt instanceof HTMLButtonElement)
  await act(async () => openRefPrompt.click())
  assert.match(document.body.textContent ?? '', /Reference image/)
  assert.match(document.body.textContent ?? '', /Go draw/)
  assert.match(document.body.textContent ?? '', /Copy prompt/)

  const refImgButton = [...document.body.querySelectorAll('button')].find(
    (b) => b.querySelector('img[src="https://example.com/ref.png"]')
  )
  assert.ok(refImgButton instanceof HTMLButtonElement)
  await act(async () => refImgButton.click())

  await act(async () => rendered.root.unmount())
  rendered.queryClient.clear()
})
