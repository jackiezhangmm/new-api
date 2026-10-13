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
import {
  Copy01Icon,
  Delete02Icon,
  FavouriteIcon,
  PencilEdit01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ExternalLink, Paintbrush } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import type { DigitalAsset } from '../types'

type AssetDetailDialogProps = {
  asset: DigitalAsset | null
  favoritePending: boolean
  onOpenChange: (open: boolean) => void
  onCopy: (asset: DigitalAsset) => void
  onCopyImageLink: (asset: DigitalAsset) => void
  onEdit: (asset: DigitalAsset) => void
  onFavorite: (asset: DigitalAsset) => void
  onDraw: (asset: DigitalAsset) => void
  onDelete: (asset: DigitalAsset) => void
}

export function AssetDetailDialog(props: AssetDetailDialogProps) {
  const { t } = useTranslation()
  const [enlargedPreview, setEnlargedPreview] = useState(false)
  const isImage = props.asset?.asset_type === 'image'

  return (
    <Dialog
      open={props.asset !== null}
      onOpenChange={props.onOpenChange}
      title={props.asset?.title ?? t('Asset details')}
      contentClassName='sm:max-w-2xl'
      bodyClassName='space-y-4'
      footer={
        props.asset ? (
          <>
            <Button
              type='button'
              variant='destructive'
              onClick={() => props.onDelete(props.asset!)}
            >
              <HugeiconsIcon icon={Delete02Icon} />
              {t('Delete')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={props.favoritePending}
              onClick={() => props.onFavorite(props.asset!)}
            >
              <HugeiconsIcon
                icon={FavouriteIcon}
                className={
                  props.asset.is_favorite
                    ? 'fill-red-500 text-red-500'
                    : undefined
                }
              />
              {props.asset.is_favorite
                ? t('Remove from favorites')
                : t('Add to favorites')}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => props.onEdit(props.asset!)}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} />
              {t('Edit')}
            </Button>
            {isImage ? (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!props.asset.image?.url}
                  onClick={() => props.onCopyImageLink(props.asset!)}
                >
                  <HugeiconsIcon icon={Copy01Icon} />
                  {t('Copy image link')}
                </Button>
                <Button
                  type='button'
                  disabled={!props.asset.image?.url}
                  onClick={() => window.open(props.asset!.image?.url, '_blank')}
                >
                  <ExternalLink className='size-4' />
                  {t('View original image')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type='button'
                  variant='outline'
                  disabled={!props.asset.content}
                  onClick={() => props.onDraw(props.asset!)}
                >
                  <Paintbrush />
                  {t('Go draw')}
                </Button>
                <Button
                  type='button'
                  disabled={!props.asset.content}
                  onClick={() => props.onCopy(props.asset!)}
                >
                  <HugeiconsIcon icon={Copy01Icon} />
                  {t('Copy prompt')}
                </Button>
              </>
            )}
          </>
        ) : null
      }
    >
      {props.asset ? (
        <div className='space-y-4'>
          {isImage ? (
            props.asset.image?.url ? (
              <div className='bg-muted/20 flex max-h-[50vh] items-center justify-center overflow-hidden rounded-md border p-2'>
                <img
                  src={props.asset.image.url}
                  alt={props.asset.title}
                  className='max-h-[46vh] max-w-full rounded object-contain'
                />
              </div>
            ) : null
          ) : props.asset.image?.url ? (
            <div className='relative overflow-hidden rounded-md border bg-muted/20'>
              <button
                type='button'
                className='relative aspect-video w-full cursor-pointer overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center justify-center'
                onClick={() => setEnlargedPreview(true)}
              >
                <img
                  src={props.asset.image.url}
                  alt={props.asset.title}
                  className='size-full object-contain'
                />
                <Badge className='border-0 bg-black/60 text-white backdrop-blur-sm absolute top-2 left-2'>
                  {t('Reference image')}
                </Badge>
              </button>
            </div>
          ) : null}

          {isImage ? (
            <div className='flex flex-wrap items-center gap-1.5'>
              {props.asset.tags.map((tag) => (
                <Badge key={tag.id} variant='secondary'>
                  {tag.name}
                </Badge>
              ))}
              {props.asset.image &&
              props.asset.image.width > 0 &&
              props.asset.image.height > 0 ? (
                <Badge variant='outline'>
                  {props.asset.image.width} × {props.asset.image.height}
                </Badge>
              ) : null}
            </div>
          ) : (
            <>
              {props.asset.content ? (
                <div className='bg-muted/40 max-h-[40vh] overflow-auto rounded-md border p-4'>
                  <p className='text-sm leading-6 break-words whitespace-pre-wrap'>
                    {props.asset.content}
                  </p>
                </div>
              ) : null}
              {props.asset.tags.length > 0 ? (
                <div className='flex flex-wrap items-center gap-1.5'>
                  {props.asset.tags.map((tag) => (
                    <Badge key={tag.id} variant='secondary'>
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {props.asset?.image?.url ? (
        <Dialog
          open={enlargedPreview}
          onOpenChange={setEnlargedPreview}
          title={props.asset.title}
          contentClassName='sm:max-w-4xl'
        >
          <div className='flex max-h-[75vh] items-center justify-center overflow-hidden p-2'>
            <img
              src={props.asset.image.url}
              alt={props.asset.title}
              className='max-h-[70vh] max-w-full rounded object-contain'
            />
          </div>
        </Dialog>
      ) : null}
    </Dialog>
  )
}
