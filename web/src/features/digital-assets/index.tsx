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
  Add01Icon,
  Database01Icon,
  Loading03Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Check, ChevronDown, X } from 'lucide-react'
import { useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useMediaQuery } from '@/hooks/use-media-query'

import {
  createDigitalAsset,
  deleteDigitalAsset,
  deleteDigitalAssetTag,
  listDigitalAssets,
  listDigitalAssetTags,
  setDigitalAssetFavorite,
  updateDigitalAsset,
} from './api'
import { DigitalAssetCard } from './components/asset-card'
import { AssetDeleteDialog } from './components/asset-delete-dialog'
import { AssetDetailDialog } from './components/asset-detail-dialog'
import { AssetFormDialog } from './components/asset-form-dialog'
import { AssetPagination } from './components/asset-pagination'
import { TagManagerDialog } from './components/tag-manager-dialog'
import type { DigitalAssetFormValues } from './lib/form'
import type { DigitalAsset, DigitalAssetPayload, DigitalAssetTag } from './types'

const FAVORITES_PAGE_SIZE = 6
const ALL_ASSETS_PAGE_SIZE = 12
const queryRoot = ['digital-assets'] as const

function mutationErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function useGalleryColumnCount(): number {
  const isXl = useMediaQuery('(min-width: 1280px)')
  const isSm = useMediaQuery('(min-width: 640px)')
  if (isXl) return 3
  if (isSm) return 2
  return 1
}

type AssetSectionProps = {
  title: string
  assets: DigitalAsset[]
  loading: boolean
  error: boolean
  emptyMessage: string
  favoritePending: boolean
  onRetry: () => void
  onOpen: (asset: DigitalAsset) => void
  onFavorite: (asset: DigitalAsset) => void
  hideTitle?: boolean
}

function AssetSection(props: AssetSectionProps) {
  const { t } = useTranslation()
  const columnCount = useGalleryColumnCount()
  let content

  if (props.loading) {
    content = (
      <div className='flex min-h-44 items-center justify-center' role='status'>
        <HugeiconsIcon icon={Loading03Icon} className='size-5 animate-spin' />
        <span className='sr-only'>{t('Loading')}</span>
      </div>
    )
  } else if (props.error) {
    content = (
      <div className='flex min-h-32 flex-col items-center justify-center gap-3 border-y py-6 text-center'>
        <p className='text-muted-foreground text-sm'>
          {t('Failed to load digital assets')}
        </p>
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={props.onRetry}
        >
          {t('Retry')}
        </Button>
      </div>
    )
  } else if (props.assets.length === 0) {
    content = (
      <div className='text-muted-foreground flex min-h-32 flex-col items-center justify-center gap-2 py-6 text-center text-sm'>
        <HugeiconsIcon icon={Database01Icon} className='size-6' />
        <p>{props.emptyMessage}</p>
      </div>
    )
  } else {
    const columns = Array.from(
      { length: columnCount },
      () => [] as DigitalAsset[]
    )
    props.assets.forEach((asset, index) => {
      columns[index % columnCount].push(asset)
    })

    content = (
      <div className='flex items-start gap-3'>
        {columns.map((colAssets, colIndex) => (
          <div key={colIndex} className='flex min-w-0 flex-1 flex-col gap-3'>
            {colAssets.map((asset) => (
              <DigitalAssetCard
                key={asset.id}
                asset={asset}
                favoritePending={props.favoritePending}
                onOpen={props.onOpen}
                onFavorite={props.onFavorite}
              />
            ))}
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className='space-y-3' aria-label={props.title}>
      {props.hideTitle ? null : (
        <h3 className='text-sm font-semibold'>{props.title}</h3>
      )}
      {content}
    </section>
  )
}

export function DigitalAssets() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [favoritesPage, setFavoritesPage] = useState(1)
  const [allPage, setAllPage] = useState(1)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const [detailAsset, setDetailAsset] = useState<DigitalAsset | null>(null)
  const [formAsset, setFormAsset] = useState<DigitalAsset | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteAsset, setDeleteAsset] = useState<DigitalAsset | null>(null)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const [deletedTag, setDeletedTag] = useState<DigitalAssetTag | null>(null)

  const allAssetType =
    selectedTypes.includes('text') && !selectedTypes.includes('image')
      ? 'text'
      : selectedTypes.includes('image') && !selectedTypes.includes('text')
        ? 'image'
        : undefined

  const favoritesQuery = useQuery({
    queryKey: [...queryRoot, 'list', 'favorites', favoritesPage],
    queryFn: () =>
      listDigitalAssets({
        page: favoritesPage,
        pageSize: FAVORITES_PAGE_SIZE,
        favorite: true,
      }),
  })
  const allAssetsQuery = useQuery({
    queryKey: [
      ...queryRoot,
      'list',
      'all',
      allPage,
      deferredSearch,
      selectedTagIds,
      allAssetType,
    ],
    queryFn: () =>
      listDigitalAssets({
        page: allPage,
        pageSize: ALL_ASSETS_PAGE_SIZE,
        search: deferredSearch,
        tagIds: selectedTagIds,
        assetType: allAssetType,
      }),
  })
  const tagsQuery = useQuery({
    queryKey: [...queryRoot, 'tags'],
    queryFn: listDigitalAssetTags,
  })

  const refreshAssetLists = async () => {
    await queryClient.invalidateQueries({ queryKey: [...queryRoot, 'list'] })
  }

  const saveMutation = useMutation({
    mutationFn: async (values: DigitalAssetFormValues) => {
      const assetType = formAsset ? formAsset.asset_type : values.asset_type
      const payload: DigitalAssetPayload = {
        asset_type: assetType,
        title: values.title.trim(),
        content: assetType === 'image' ? '' : values.content,
        tags: values.tags,
        image_id: values.image_id ? values.image_id.trim() : null,
      }
      return formAsset
        ? updateDigitalAsset(formAsset.id, payload)
        : createDigitalAsset(payload)
    },
    onSuccess: async (asset) => {
      setFormOpen(false)
      setFormAsset(null)
      setDetailAsset((current) => (current?.id === asset.id ? asset : current))
      await Promise.all([
        refreshAssetLists(),
        queryClient.invalidateQueries({ queryKey: [...queryRoot, 'tags'] }),
      ])
      toast.success(t('Asset saved'))
    },
    onError: (error) => {
      toast.error(mutationErrorMessage(error, t('Failed to save asset')))
    },
  })

  const favoriteMutation = useMutation({
    mutationFn: (asset: DigitalAsset) =>
      setDigitalAssetFavorite(asset.id, !asset.is_favorite),
    onSuccess: async (asset, previousAsset) => {
      setDetailAsset((current) => (current?.id === asset.id ? asset : current))
      if (
        previousAsset.is_favorite &&
        !asset.is_favorite &&
        favoritesPage > 1 &&
        favoritesQuery.data?.items.length === 1
      ) {
        setFavoritesPage((page) => page - 1)
      }
      await refreshAssetLists()
    },
    onError: (error) => {
      toast.error(mutationErrorMessage(error, t('Failed to update favorite')))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (asset: DigitalAsset) => deleteDigitalAsset(asset.id),
    onSuccess: async (_result, deletedAsset) => {
      setDeleteAsset(null)
      setDetailAsset(null)
      if (allPage > 1 && allAssetsQuery.data?.items.length === 1) {
        setAllPage((page) => page - 1)
      }
      if (
        deletedAsset.is_favorite &&
        favoritesPage > 1 &&
        favoritesQuery.data?.items.length === 1
      ) {
        setFavoritesPage((page) => page - 1)
      }
      await refreshAssetLists()
      toast.success(t('Asset deleted'))
    },
    onError: (error) => {
      toast.error(mutationErrorMessage(error, t('Failed to delete asset')))
    },
  })

  const tagDeleteMutation = useMutation({
    mutationFn: deleteDigitalAssetTag,
    onSuccess: async (_result, tagId) => {
      const tag = tagsQuery.data?.find((candidate) => candidate.id === tagId)
      if (tag) {
        setDeletedTag(tag)
        setDetailAsset((current) =>
          current
            ? {
                ...current,
                tags: current.tags.filter(
                  (candidate) => candidate.id !== tagId
                ),
              }
            : current
        )
      }
      setSelectedTagIds((current) => current.filter((id) => id !== tagId))
      await Promise.all([
        refreshAssetLists(),
        queryClient.invalidateQueries({ queryKey: [...queryRoot, 'tags'] }),
      ])
      toast.success(t('Tag deleted'))
    },
    onError: (error) => {
      toast.error(mutationErrorMessage(error, t('Failed to delete tag')))
    },
  })

  const drawWithAsset = (asset: DigitalAsset) => {
    void navigate({
      to: '/playground/drawing',
      search: { prompt: asset.content },
    })
  }

  const openCreate = () => {
    setFormAsset(null)
    setFormOpen(true)
  }

  const openEdit = (asset: DigitalAsset) => {
    setDetailAsset(null)
    setFormAsset(asset)
    setFormOpen(true)
  }

  const copyPrompt = async (asset: DigitalAsset) => {
    try {
      await navigator.clipboard.writeText(asset.content)
      toast.success(t('Prompt copied'))
    } catch {
      toast.error(t('Failed to copy prompt'))
    }
  }

  const copyImageLink = async (asset: DigitalAsset) => {
    if (!asset.image?.url) return
    try {
      await navigator.clipboard.writeText(asset.image.url)
      toast.success(t('Image link copied'))
    } catch {
      toast.error(t('Failed to copy image link'))
    }
  }

  const toggleTag = (tagId: number) => {
    setAllPage(1)
    setSelectedTagIds((current) =>
      current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId]
    )
  }

  const toggleType = (type: 'text' | 'image') => {
    setAllPage(1)
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : [...current, type]
    )
  }

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Digital Assets')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto max-w-6xl space-y-8 pb-4'>
            <div className='space-y-4'>
              <AssetSection
                title={t('My Favorites')}
                assets={favoritesQuery.data?.items ?? []}
                loading={favoritesQuery.isLoading}
                error={favoritesQuery.isError}
                emptyMessage={t('Favorite assets will appear here.')}
                favoritePending={favoriteMutation.isPending}
                onRetry={() => favoritesQuery.refetch()}
                onOpen={setDetailAsset}
                onFavorite={(asset) => favoriteMutation.mutate(asset)}
              />
              <AssetPagination
                page={favoritesPage}
                pageSize={FAVORITES_PAGE_SIZE}
                total={favoritesQuery.data?.total ?? 0}
                onPageChange={setFavoritesPage}
              />
            </div>

            <div className='space-y-4'>
              <div className='space-y-3'>
                <h3 className='text-sm font-semibold'>{t('All Assets')}</h3>
                <div className='grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]'>
                  <div className='relative'>
                    <HugeiconsIcon
                      icon={Search01Icon}
                      className='text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2'
                    />
                    <Input
                      value={search}
                      className='pl-9'
                      aria-label={t('Search assets')}
                      placeholder={t('Search titles and content')}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setAllPage(1)
                      }}
                    />
                  </div>
                  <ButtonGroup aria-label={t('Filter by type')}>
                    <Button
                      type='button'
                      variant={
                        selectedTypes.includes('text') ? 'default' : 'outline'
                      }
                      aria-pressed={selectedTypes.includes('text')}
                      onClick={() => toggleType('text')}
                    >
                      {t('Prompt')}
                    </Button>
                    <Button
                      type='button'
                      variant={
                        selectedTypes.includes('image') ? 'default' : 'outline'
                      }
                      aria-pressed={selectedTypes.includes('image')}
                      onClick={() => toggleType('image')}
                    >
                      {t('Image')}
                    </Button>
                  </ButtonGroup>
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          type='button'
                          variant='outline'
                          aria-label={t('Filter by tags')}
                        />
                      }
                    >
                      {t('Filter by tags')}
                      {selectedTagIds.length > 0 ? (
                        <Badge variant='secondary' className='px-1.5'>
                          {selectedTagIds.length}
                        </Badge>
                      ) : null}
                      <ChevronDown className='size-4' aria-hidden='true' />
                    </PopoverTrigger>
                    <PopoverContent align='end' className='w-72'>
                      {tagsQuery.data?.length ? (
                        <div
                          className='flex max-h-56 flex-wrap gap-1.5 overflow-y-auto'
                          aria-label={t('Filter by tags')}
                        >
                          {tagsQuery.data.map((tag) => {
                            const selected = selectedTagIds.includes(tag.id)
                            return (
                              <Button
                                key={tag.id}
                                type='button'
                                variant={selected ? 'secondary' : 'ghost'}
                                size='xs'
                                className='max-w-full'
                                aria-pressed={selected}
                                title={tag.name}
                                onClick={() => toggleTag(tag.id)}
                              >
                                {selected ? (
                                  <Check
                                    className='size-3'
                                    aria-hidden='true'
                                  />
                                ) : null}
                                <span className='truncate'>{tag.name}</span>
                              </Button>
                            )
                          })}
                        </div>
                      ) : (
                        <p className='text-muted-foreground py-3 text-center text-sm'>
                          {t('No tags yet')}
                        </p>
                      )}
                      <div className='flex items-center justify-between gap-2 border-t pt-2'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          onClick={() => setTagManagerOpen(true)}
                        >
                          {t('Manage tags')}
                        </Button>
                        {selectedTagIds.length > 0 ? (
                          <Button
                            type='button'
                            variant='ghost'
                            size='sm'
                            className='self-end'
                            onClick={() => {
                              setSelectedTagIds([])
                              setAllPage(1)
                            }}
                          >
                            {t('Clear filters')}
                          </Button>
                        ) : null}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button type='button' onClick={openCreate}>
                    <HugeiconsIcon icon={Add01Icon} />
                    {t('New asset')}
                  </Button>
                </div>
              </div>
              {selectedTagIds.length > 0 ? (
                <div
                  className='flex flex-wrap items-center gap-1.5'
                  aria-label={t('Filter by tags')}
                >
                  {tagsQuery.data
                    ?.filter((tag) => selectedTagIds.includes(tag.id))
                    .map((tag) => (
                      <Badge
                        key={tag.id}
                        variant='secondary'
                        className='max-w-48 gap-1'
                      >
                        <span className='truncate' title={tag.name}>
                          {tag.name}
                        </span>
                        <button
                          type='button'
                          aria-label={t('Remove tag {{tag}}', {
                            tag: tag.name,
                          })}
                          onClick={() => toggleTag(tag.id)}
                        >
                          <X className='size-3' aria-hidden='true' />
                        </button>
                      </Badge>
                    ))}
                  <Button
                    type='button'
                    variant='ghost'
                    size='xs'
                    onClick={() => {
                      setSelectedTagIds([])
                      setAllPage(1)
                    }}
                  >
                    {t('Clear filters')}
                  </Button>
                </div>
              ) : null}
              <AssetSection
                title={t('All Assets')}
                assets={allAssetsQuery.data?.items ?? []}
                loading={allAssetsQuery.isLoading}
                error={allAssetsQuery.isError}
                emptyMessage={
                  deferredSearch || selectedTagIds.length
                    ? t('No prompts match the current filters.')
                    : t('Create your first prompt to get started.')
                }
                favoritePending={favoriteMutation.isPending}
                onRetry={() => allAssetsQuery.refetch()}
                onOpen={setDetailAsset}
                onFavorite={(asset) => favoriteMutation.mutate(asset)}
                hideTitle
              />
              <AssetPagination
                page={allPage}
                pageSize={ALL_ASSETS_PAGE_SIZE}
                total={allAssetsQuery.data?.total ?? 0}
                onPageChange={setAllPage}
              />
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <AssetDetailDialog
        asset={detailAsset}
        favoritePending={favoriteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDetailAsset(null)
        }}
        onCopy={copyPrompt}
        onCopyImageLink={copyImageLink}
        onEdit={openEdit}
        onFavorite={(asset) => favoriteMutation.mutate(asset)}
        onDraw={drawWithAsset}
        onDelete={setDeleteAsset}
      />
      <AssetFormDialog
        open={formOpen}
        asset={formAsset}
        availableTags={tagsQuery.data ?? []}
        deletedTag={deletedTag}
        pending={saveMutation.isPending}
        onOpenChange={(open) => {
          setFormOpen(open)
          if (!open) setFormAsset(null)
        }}
        onManageTags={() => setTagManagerOpen(true)}
        onSubmit={async (values) => {
          await saveMutation.mutateAsync(values)
        }}
      />
      <TagManagerDialog
        open={tagManagerOpen}
        tags={tagsQuery.data ?? []}
        pending={tagDeleteMutation.isPending}
        onOpenChange={setTagManagerOpen}
        onDelete={(tag) => tagDeleteMutation.mutate(tag.id)}
      />
      <AssetDeleteDialog
        asset={deleteAsset}
        pending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteAsset(null)
        }}
        onConfirm={(asset) => deleteMutation.mutate(asset)}
      />
    </>
  )
}
