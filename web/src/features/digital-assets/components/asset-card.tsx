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
import { FavouriteIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'

import type { DigitalAsset } from '../types'

type DigitalAssetCardProps = {
  asset: DigitalAsset
  favoritePending: boolean
  onOpen: (asset: DigitalAsset) => void
  onFavorite: (asset: DigitalAsset) => void
}

export function DigitalAssetCard(props: DigitalAssetCardProps) {
  const { t } = useTranslation()
  const isImage = props.asset.asset_type === 'image'
  const imageUrl = props.asset.image?.url

  const favoriteButton = (overlay = false) => (
    <Button
      type='button'
      variant='ghost'
      size='icon-sm'
      disabled={props.favoritePending}
      className={
        overlay
          ? 'size-7 rounded-full border-0 bg-black/60 text-white shadow-sm backdrop-blur-sm hover:bg-black/80 hover:text-white'
          : undefined
      }
      aria-label={
        props.asset.is_favorite
          ? t('Remove from favorites')
          : t('Add to favorites')
      }
      onClick={() => props.onFavorite(props.asset)}
    >
      <HugeiconsIcon
        icon={FavouriteIcon}
        className={
          props.asset.is_favorite
            ? 'fill-red-500 text-red-500'
            : undefined
        }
      />
    </Button>
  )

  const openTrigger = (
    <button
      type='button'
      className='focus-visible:ring-ring absolute inset-0 z-0 cursor-pointer rounded-lg focus-visible:ring-2 focus-visible:outline-none'
      aria-label={
        isImage
          ? t('Open image {{title}}', { title: props.asset.title })
          : t('Open prompt {{title}}', { title: props.asset.title })
      }
      onClick={() => props.onOpen(props.asset)}
    />
  )

  if (isImage) {
    const aspectRatio =
      props.asset.image &&
      props.asset.image.width > 0 &&
      props.asset.image.height > 0
        ? `${props.asset.image.width} / ${props.asset.image.height}`
        : '4 / 3'

    return (
      <Card
        size='sm'
        style={{ aspectRatio }}
        className='hover:shadow-md min-h-[180px] max-h-[380px] relative flex w-full flex-col justify-between overflow-hidden rounded-lg border !p-0 !py-0 !gap-0 p-0 py-0 gap-0 data-[size=sm]:p-0 data-[size=sm]:py-0 data-[size=sm]:gap-0 transition-shadow'
      >
        {openTrigger}
        <div className='pointer-events-none absolute inset-0 size-full bg-muted'>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={props.asset.title}
              className='size-full object-cover'
              loading='lazy'
            />
          ) : (
            <div className='text-muted-foreground flex size-full items-center justify-center text-xs'>
              {props.asset.title}
            </div>
          )}
        </div>

        <div className='pointer-events-none relative z-1 flex items-center justify-between p-3'>
          <Badge
            variant='outline'
            className='border-0 bg-black/60 text-white backdrop-blur-sm'
          >
            {t('Image')}
          </Badge>
          <div className='pointer-events-auto'>{favoriteButton(true)}</div>
        </div>

        <div className='pointer-events-none relative z-1 flex flex-col gap-2 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 pt-8'>
          <p className='line-clamp-1 text-sm font-semibold text-white drop-shadow-sm'>
            {props.asset.title}
          </p>
          {props.asset.tags.length > 0 ? (
            <div className='flex flex-wrap gap-1 overflow-hidden'>
              {props.asset.tags.slice(0, 4).map((tag) => (
                <Badge
                  key={tag.id}
                  variant='outline'
                  className='border-white/30 bg-black/40 text-xs text-white backdrop-blur-sm'
                >
                  {tag.name}
                </Badge>
              ))}
              {props.asset.tags.length > 4 ? (
                <Badge
                  variant='outline'
                  className='border-white/30 bg-black/40 text-xs text-white backdrop-blur-sm'
                >
                  +{props.asset.tags.length - 4}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    )
  }

  if (imageUrl) {
    return (
      <Card
        size='sm'
        className='hover:bg-muted/30 relative flex flex-col overflow-hidden rounded-lg border !p-0 !py-0 !gap-0 p-0 py-0 gap-0 data-[size=sm]:p-0 data-[size=sm]:py-0 data-[size=sm]:gap-0 transition-colors'
      >
        {openTrigger}
        <div className='pointer-events-none relative aspect-video w-full shrink-0 overflow-hidden bg-muted'>
          <img
            src={imageUrl}
            alt={props.asset.title}
            className='size-full object-cover'
            loading='lazy'
          />
          <div className='absolute inset-x-0 top-0 flex items-center justify-between p-2.5'>
            <Badge
              variant='outline'
              className='border-0 bg-black/60 text-white backdrop-blur-sm'
            >
              {t('Prompt')}
            </Badge>
            <div className='pointer-events-auto'>{favoriteButton(true)}</div>
          </div>
        </div>

        <div className='pointer-events-none relative z-1 flex flex-col gap-2 p-3.5'>
          <h4 className='line-clamp-1 text-sm font-semibold'>
            {props.asset.title}
          </h4>
          <p className='text-muted-foreground line-clamp-2 text-left text-sm leading-5 whitespace-pre-wrap'>
            {props.asset.content}
          </p>
          {props.asset.tags.length > 0 ? (
            <div className='flex flex-wrap gap-1 overflow-hidden pt-0.5'>
              {props.asset.tags.slice(0, 4).map((tag) => (
                <Badge key={tag.id} variant='secondary'>
                  {tag.name}
                </Badge>
              ))}
              {props.asset.tags.length > 4 ? (
                <Badge variant='outline'>+{props.asset.tags.length - 4}</Badge>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>
    )
  }

  return (
    <Card
      size='sm'
      className='hover:bg-muted/30 relative flex flex-col overflow-hidden rounded-lg border !p-3.5 !py-3.5 !gap-2.5 p-3.5 py-3.5 gap-2.5 data-[size=sm]:p-3.5 data-[size=sm]:py-3.5 data-[size=sm]:gap-2.5 transition-colors'
    >
      {openTrigger}
      <div className='pointer-events-none relative z-1 flex items-center justify-between'>
        <Badge variant='secondary'>{t('Prompt')}</Badge>
        <div className='pointer-events-auto'>{favoriteButton(false)}</div>
      </div>
      <div className='pointer-events-none relative z-1 flex flex-col gap-1.5'>
        <h4 className='line-clamp-1 text-sm font-semibold'>
          {props.asset.title}
        </h4>
        <p className='text-muted-foreground line-clamp-3 text-left text-sm leading-5 whitespace-pre-wrap'>
          {props.asset.content}
        </p>
      </div>
      {props.asset.tags.length > 0 ? (
        <div className='pointer-events-none relative z-1 flex flex-wrap gap-1 overflow-hidden pt-0.5'>
          {props.asset.tags.slice(0, 4).map((tag) => (
            <Badge key={tag.id} variant='secondary'>
              {tag.name}
            </Badge>
          ))}
          {props.asset.tags.length > 4 ? (
            <Badge variant='outline'>+{props.asset.tags.length - 4}</Badge>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
