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
import { zodResolver } from '@hookform/resolvers/zod'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Check, Image as ImageIcon, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import { uploadAssetImage } from '../api'
import {
  DIGITAL_ASSET_DEFAULT_TAGS,
  getDigitalAssetFormSchema,
  type DigitalAssetFormValues,
} from '../lib/form'
import type { DigitalAsset, DigitalAssetImage, DigitalAssetTag } from '../types'

type AssetFormDialogProps = {
  open: boolean
  asset: DigitalAsset | null
  initialPrompt?: { title: string; content: string }
  availableTags: DigitalAssetTag[]
  deletedTag: DigitalAssetTag | null
  pending: boolean
  onOpenChange: (open: boolean) => void
  onManageTags: () => void
  onSubmit: (values: DigitalAssetFormValues) => Promise<void>
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function normalizeTag(name: string): string {
  return name.trim().toLowerCase()
}

export function AssetFormDialog(props: AssetFormDialogProps) {
  const { t } = useTranslation()
  const [assetType, setAssetType] = useState<'text' | 'image'>('text')
  const [previewImage, setPreviewImage] = useState<DigitalAssetImage | null>(
    null
  )
  const [uploading, setUploading] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const schema = useMemo(() => getDigitalAssetFormSchema(t), [t])
  const form = useForm<DigitalAssetFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      asset_type: 'text',
      title: '',
      content: '',
      tags: [],
      image_id: undefined,
    },
  })

  useEffect(() => {
    if (!props.open) return
    const currentType = props.asset ? props.asset.asset_type : 'text'
    setAssetType(currentType)
    setPreviewImage(props.asset?.image ?? null)
    form.reset({
      asset_type: currentType,
      title: props.asset?.title ?? props.initialPrompt?.title ?? '',
      content:
        currentType === 'image'
          ? ''
          : (props.asset?.content ?? props.initialPrompt?.content ?? ''),
      tags: props.asset?.tags.map((tag) => tag.name) ?? [],
      image_id:
        props.asset?.image_id ?? props.asset?.image?.id ?? undefined,
    })
    setTagInput('')
    setUploading(false)
  }, [form, props.asset, props.initialPrompt, props.open])

  useEffect(() => {
    if (!props.deletedTag) return
    const currentTags = form.getValues('tags')
    form.setValue(
      'tags',
      currentTags.filter(
        (tag) =>
          normalizeTag(tag) !== normalizeTag(props.deletedTag?.name ?? '')
      ),
      { shouldValidate: true }
    )
  }, [form, props.deletedTag])

  const selectedTags = form.watch('tags')
  const allTags = [
    ...DIGITAL_ASSET_DEFAULT_TAGS,
    ...props.availableTags.map((tag) => tag.name),
    ...selectedTags,
  ].filter(
    (name, index, names) =>
      names.findIndex(
        (candidate) => normalizeTag(candidate) === normalizeTag(name)
      ) === index
  )

  const handleTabChange = (val: string) => {
    const nextType = val as 'text' | 'image'
    setAssetType(nextType)
    form.setValue('asset_type', nextType)
    form.clearErrors('content')
    form.clearErrors('image_id')
  }

  const handleFileSelect = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(t('Image file cannot exceed 10MB'))
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
      toast.error(
        t('Invalid image format, only JPEG, PNG, and WebP are supported')
      )
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    try {
      setUploading(true)
      const uploaded = await uploadAssetImage(file)
      setPreviewImage(uploaded)
      form.setValue('image_id', uploaded.id, { shouldValidate: true })
      toast.success(t('Image uploaded'))
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t('Failed to upload image')
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRemoveImage = () => {
    setPreviewImage(null)
    form.setValue('image_id', undefined, { shouldValidate: true })
  }

  const addTag = (rawName: string) => {
    const name = rawName.trim()
    if (!name) return
    if (name.length > 32) {
      toast.error(t('Tag must be 32 characters or fewer'))
      return
    }
    const existingTag = allTags.find(
      (tag) => normalizeTag(tag) === normalizeTag(name)
    )
    if (
      selectedTags.some(
        (tag) => normalizeTag(tag) === normalizeTag(existingTag ?? name)
      )
    ) {
      setTagInput('')
      return
    }
    if (selectedTags.length >= 20) {
      toast.error(t('You can add up to 20 tags'))
      return
    }
    form.setValue('tags', [...selectedTags, existingTag ?? name], {
      shouldValidate: true,
    })
    setTagInput('')
  }

  const toggleTag = (name: string) => {
    const selected = selectedTags.some(
      (tag) => normalizeTag(tag) === normalizeTag(name)
    )
    if (selected) {
      form.setValue(
        'tags',
        selectedTags.filter((tag) => normalizeTag(tag) !== normalizeTag(name)),
        { shouldValidate: true }
      )
      return
    }
    addTag(name)
  }

  const submit = form.handleSubmit(async (values) => {
    try {
      await props.onSubmit(values)
    } catch {
      // mutation handles error display and keeps form open
    }
  })

  let dialogTitle = t('New asset')
  if (props.asset) {
    dialogTitle =
      props.asset.asset_type === 'image'
        ? t('Edit image asset')
        : t('Edit prompt asset')
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={dialogTitle}
      contentClassName='sm:max-w-xl'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='digital-asset-form'
            disabled={props.pending || uploading}
          >
            {props.pending ? (
              <HugeiconsIcon icon={Loading03Icon} className='animate-spin' />
            ) : null}
            {t('Save')}
          </Button>
        </>
      }
    >
      <input
        ref={fileInputRef}
        type='file'
        accept='image/jpeg,image/png,image/webp'
        className='hidden'
        onChange={handleFileSelect}
      />

      {!props.asset ? (
        <Tabs
          value={assetType}
          onValueChange={handleTabChange}
          className='w-full'
        >
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='text'>{t('Prompt asset')}</TabsTrigger>
            <TabsTrigger value='image'>{t('Image asset')}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      <Form {...form}>
        <form id='digital-asset-form' className='space-y-4' onSubmit={submit}>
          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Title')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoFocus
                    maxLength={100}
                    placeholder={t('Give this asset a clear title')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {assetType === 'text' ? (
            <>
              <FormField
                control={form.control}
                name='content'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Prompt content')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={8}
                        maxLength={100000}
                        className='min-h-40 resize-y'
                        placeholder={t('Enter the complete prompt')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem>
                <FormLabel>{t('Reference image (optional)')}</FormLabel>
                {previewImage ? (
                  <div className='flex items-center justify-between gap-3 rounded-md border p-2 bg-muted/20'>
                    <div className='flex items-center gap-3 min-w-0'>
                      <img
                        src={previewImage.url}
                        alt={t('Reference image')}
                        className='size-14 rounded object-cover border shrink-0'
                      />
                      <div className='text-xs text-muted-foreground truncate'>
                        {previewImage.width > 0 && previewImage.height > 0 ? (
                          <span>
                            {previewImage.width} × {previewImage.height}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='text-destructive hover:text-destructive'
                      onClick={handleRemoveImage}
                    >
                      <Trash2 className='size-4' />
                      {t('Remove')}
                    </Button>
                  </div>
                ) : (
                  <div className='flex items-center gap-3'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          className='size-4 animate-spin'
                        />
                      ) : (
                        <Upload className='size-4' />
                      )}
                      {t('Upload reference image')}
                    </Button>
                    <span className='text-xs text-muted-foreground'>
                      {t('JPEG, PNG, WebP up to 10MB')}
                    </span>
                  </div>
                )}
              </FormItem>
            </>
          ) : (
            <FormItem>
              <FormLabel>{t('Image')}</FormLabel>
              {previewImage ? (
                <div className='space-y-2'>
                  <div className='relative flex max-h-52 items-center justify-center overflow-hidden rounded-md border bg-muted/20 p-2'>
                    <img
                      src={previewImage.url}
                      alt={t('Image asset')}
                      className='max-h-48 max-w-full rounded object-contain'
                    />
                  </div>
                  <div className='flex items-center justify-between text-xs text-muted-foreground'>
                    <span>
                      {previewImage.width > 0 && previewImage.height > 0
                        ? `${previewImage.width} × ${previewImage.height}`
                        : ''}
                    </span>
                    <div className='flex gap-2'>
                      <Button
                        type='button'
                        variant='outline'
                        size='xs'
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploading ? (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            className='size-3 animate-spin'
                          />
                        ) : null}
                        {t('Replace image')}
                      </Button>
                      <Button
                        type='button'
                        variant='ghost'
                        size='xs'
                        className='text-destructive hover:text-destructive'
                        onClick={handleRemoveImage}
                      >
                        {t('Remove')}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type='button'
                  disabled={uploading}
                  className='flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors hover:bg-muted/40 cursor-pointer disabled:opacity-50'
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <HugeiconsIcon
                      icon={Loading03Icon}
                      className='size-8 animate-spin text-muted-foreground'
                    />
                  ) : (
                    <ImageIcon className='size-8 text-muted-foreground' />
                  )}
                  <div className='space-y-1'>
                    <p className='text-sm font-medium'>
                      {uploading
                        ? t('Loading')
                        : t('Click to upload image')}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {t('JPEG, PNG, WebP up to 10MB')}
                    </p>
                  </div>
                </button>
              )}
              {form.formState.errors.image_id ? (
                <p className='text-destructive text-sm font-medium'>
                  {form.formState.errors.image_id.message}
                </p>
              ) : null}
            </FormItem>
          )}

          <FormItem>
            <div className='flex items-center justify-between gap-3'>
              <FormLabel htmlFor='digital-asset-tag-input'>
                {t('Tags')}
              </FormLabel>
              {props.asset ? (
                <Button
                  type='button'
                  variant='outline'
                  size='xs'
                  onClick={props.onManageTags}
                >
                  {t('Manage tags')}
                </Button>
              ) : null}
            </div>
            <div
              className='flex max-h-36 flex-wrap gap-1.5 overflow-y-auto p-1'
              aria-label={t('Suggested tags')}
            >
              {allTags.map((tag) => {
                const selected = selectedTags.some(
                  (name) => normalizeTag(name) === normalizeTag(tag)
                )
                const selectionDisabled = !selected && selectedTags.length >= 20
                return (
                  <Button
                    key={normalizeTag(tag)}
                    type='button'
                    variant={selected ? 'secondary' : 'ghost'}
                    size='xs'
                    className='max-w-full'
                    disabled={selectionDisabled}
                    aria-pressed={selected}
                    title={tag}
                    onClick={() => toggleTag(tag)}
                  >
                    {selected ? (
                      <Check className='size-3' aria-hidden='true' />
                    ) : null}
                    <span className='truncate'>{tag}</span>
                  </Button>
                )
              })}
            </div>
            <Input
              id='digital-asset-tag-input'
              value={tagInput}
              maxLength={32}
              disabled={selectedTags.length >= 20}
              placeholder={t('Type and press Enter to create a new tag')}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                  return
                }
                event.preventDefault()
                addTag(tagInput)
              }}
            />
          </FormItem>
        </form>
      </Form>
    </Dialog>
  )
}
