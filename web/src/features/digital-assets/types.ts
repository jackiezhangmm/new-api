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
export type DigitalAssetTag = {
  id: number
  user_id: number
  name: string
  created_at: number
  updated_at: number
}

export type DigitalAssetImage = {
  id: string
  url: string
  width: number
  height: number
  bytes?: number
  mime_type: string
}

export type DigitalAsset = {
  id: number
  user_id: number
  asset_type: 'text' | 'image'
  title: string
  content: string
  image_id?: string
  image?: DigitalAssetImage
  is_favorite: boolean
  created_at: number
  updated_at: number
  tags: DigitalAssetTag[]
}

export type DigitalAssetPayload = {
  asset_type: 'text' | 'image'
  title: string
  content: string
  tags: string[]
  image_id?: string | null
}

export type DigitalAssetList = {
  page: number
  page_size: number
  total: number
  items: DigitalAsset[]
}

export type ApiResponse<T> = {
  success: boolean
  message: string
  data: T
}
