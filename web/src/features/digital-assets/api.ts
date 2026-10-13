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
import { api } from '@/lib/api'

import type {
  ApiResponse,
  DigitalAsset,
  DigitalAssetImage,
  DigitalAssetList,
  DigitalAssetPayload,
  DigitalAssetTag,
} from './types'

function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success) {
    throw new Error(response.message)
  }
  return response.data
}

export async function listDigitalAssets(params: {
  page: number
  pageSize: number
  favorite?: boolean
  search?: string
  tagIds?: number[]
  assetType?: 'text' | 'image'
}): Promise<DigitalAssetList> {
  const response = await api.get<ApiResponse<DigitalAssetList>>(
    '/api/digital-assets/',
    {
      params: {
        p: params.page,
        page_size: params.pageSize,
        favorite: params.favorite,
        search: params.search || undefined,
        tag_id: params.tagIds?.length ? params.tagIds : undefined,
        asset_type: params.assetType || undefined,
      },
      paramsSerializer: { indexes: null },
    }
  )
  return unwrap(response.data)
}

export async function listDigitalAssetTags(): Promise<DigitalAssetTag[]> {
  const response = await api.get<ApiResponse<DigitalAssetTag[]>>(
    '/api/digital-assets/tags'
  )
  return unwrap(response.data)
}

export async function deleteDigitalAssetTag(id: number): Promise<void> {
  const response = await api.delete<ApiResponse<null>>(
    `/api/digital-assets/tags/${id}`
  )
  unwrap(response.data)
}

export async function createDigitalAsset(
  payload: DigitalAssetPayload
): Promise<DigitalAsset> {
  const response = await api.post<ApiResponse<DigitalAsset>>(
    '/api/digital-assets/',
    payload
  )
  return unwrap(response.data)
}

export async function updateDigitalAsset(
  id: number,
  payload: DigitalAssetPayload
): Promise<DigitalAsset> {
  const response = await api.put<ApiResponse<DigitalAsset>>(
    `/api/digital-assets/${id}`,
    payload
  )
  return unwrap(response.data)
}

export async function setDigitalAssetFavorite(
  id: number,
  isFavorite: boolean
): Promise<DigitalAsset> {
  const response = await api.patch<ApiResponse<DigitalAsset>>(
    `/api/digital-assets/${id}/favorite`,
    { is_favorite: isFavorite }
  )
  return unwrap(response.data)
}

export async function deleteDigitalAsset(id: number): Promise<void> {
  const response = await api.delete<ApiResponse<null>>(
    `/api/digital-assets/${id}`
  )
  unwrap(response.data)
}

export async function uploadAssetImage(
  file: File
): Promise<DigitalAssetImage> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await api.post<ApiResponse<DigitalAssetImage>>(
    '/api/images',
    formData
  )
  return unwrap(response.data)
}
