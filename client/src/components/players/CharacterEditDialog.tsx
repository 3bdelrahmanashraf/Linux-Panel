import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { getUserErrorMessage } from '@/lib/errorMessage'
import {
  CHARACTER_STATS,
  getCharacterOptions,
  updateCharacter,
  type CharacterChanges,
  type CharacterColor,
  type CharacterOptions,
  type CharacterSheet,
} from '@/lib/characterApi'

// The Character tab's edit form. Every field is optional and only the values
// the operator actually changed are sent, so a save can't silently overwrite
// something the bridge reported but the form didn't pre-fill. Gated by the
// caller on players.gm_tools; the server enforces it again.

function toHex(color?: CharacterColor): string {
  if (color?.r === undefined || color?.g === undefined || color?.b === undefined) return '#000000'
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function fromHex(hex: string): CharacterColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

/** `undefined` for a missing key, so "not set" and "0" are distinguishable. */
function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function CharacterEditDialog({
  username,
  open,
  onOpenChange,
  sheet,
  online,
  onSaved,
}: {
  username: string
  open: boolean
  onOpenChange: (open: boolean) => void
  sheet: CharacterSheet | null
  online: boolean
  onSaved?: () => void
}) {
  const { t } = useTranslation('players')
  const { toast } = useToast()

  const [options, setOptions] = useState<CharacterOptions | null>(null)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [forename, setForename] = useState('')
  const [surname, setSurname] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [hairModel, setHairModel] = useState('')
  const [hairColor, setHairColor] = useState('#000000')
  const [beardModel, setBeardModel] = useState('')
  const [beardColor, setBeardColor] = useState('#000000')
  const [skinTexture, setSkinTexture] = useState('')
  const [weight, setWeight] = useState('')
  const [profession, setProfession] = useState('')
  const [stats, setStats] = useState<Record<string, string>>({})
  const [skills, setSkills] = useState<Record<string, string>>({})
  const [traitsAdd, setTraitsAdd] = useState<string[]>([])
  const [traitsRemove, setTraitsRemove] = useState<string[]>([])
  const [addChoice, setAddChoice] = useState('')

  const appearance = sheet?.summary?.appearance
  const isFemale = appearance?.isFemale === true

  // Pre-fill from the sheet each time the dialog opens, and load the option
  // lists (hair/beard/traits/professions) once.
  useEffect(() => {
    if (!open) return
    setForename(appearance?.forename ?? '')
    setSurname(appearance?.surname ?? '')
    setDisplayName(appearance?.displayName ?? '')
    setHairModel(appearance?.hairModel ?? '')
    setHairColor(toHex(appearance?.hairColor))
    setBeardModel(appearance?.beardModel ?? '')
    setBeardColor(toHex(appearance?.beardColor))
    setSkinTexture(appearance?.skinTextureIndex !== undefined ? String(appearance.skinTextureIndex) : '')
    setWeight(sheet?.summary?.bodyWeight !== undefined ? String(sheet.summary.bodyWeight) : '')
    setProfession(sheet?.summary?.profession?.id ?? '')
    const nextStats: Record<string, string> = {}
    for (const id of CHARACTER_STATS) {
      const value = sheet?.stats?.[id]?.value
      nextStats[id] = value !== undefined ? String(value) : ''
    }
    setStats(nextStats)
    const nextSkills: Record<string, string> = {}
    for (const perk of sheet?.skills?.perks ?? []) {
      nextSkills[perk.id] = perk.level !== undefined ? String(perk.level) : ''
    }
    setSkills(nextSkills)
    setTraitsAdd([])
    setTraitsRemove([])
    setAddChoice('')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setOptionsLoading(true)
    getCharacterOptions()
      .then((result) => {
        if (!cancelled) setOptions(result)
      })
      .catch(() => {
        if (!cancelled) setOptions({ available: false })
      })
      .finally(() => {
        if (!cancelled) setOptionsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Hair styles to suggest: the gender-appropriate list the bridge reported, or
  // none when it couldn't read them. The field is free text either way, so a
  // model the options don't list (a mod's, say) can still be typed in.
  const hairSuggestions = useMemo(
    () => (isFemale ? options?.hair?.female : options?.hair?.male) ?? [],
    [options, isFemale],
  )
  const beardSuggestions = useMemo(() => options?.beard ?? [], [options])
  const currentTraitsList = useMemo(() => sheet?.traits ?? [], [sheet])

  const buildChanges = useCallback((): CharacterChanges => {
    const changes: CharacterChanges = {}
    if (forename !== (appearance?.forename ?? '')) changes.forename = forename
    if (surname !== (appearance?.surname ?? '')) changes.surname = surname
    if (displayName !== (appearance?.displayName ?? '')) changes.displayName = displayName
    if (hairModel !== (appearance?.hairModel ?? '')) changes.hairModel = hairModel
    if (beardModel !== (appearance?.beardModel ?? '')) changes.beardModel = beardModel
    const nextHairColor = fromHex(hairColor)
    if (nextHairColor && hairColor !== toHex(appearance?.hairColor)) changes.hairColor = nextHairColor
    const nextBeardColor = fromHex(beardColor)
    if (nextBeardColor && beardColor !== toHex(appearance?.beardColor)) changes.beardColor = nextBeardColor
    const skinValue = numberOrUndefined(skinTexture)
    if (skinValue !== undefined && skinValue !== appearance?.skinTextureIndex) changes.skinTextureIndex = skinValue
    const weightValue = numberOrUndefined(weight)
    if (weightValue !== undefined && weightValue !== sheet?.summary?.bodyWeight) changes.weight = weightValue
    if (profession && profession !== (sheet?.summary?.profession?.id ?? '')) changes.profession = profession

    const changedStats: Partial<Record<string, number>> = {}
    for (const id of CHARACTER_STATS) {
      const value = numberOrUndefined(stats[id] ?? '')
      const current = sheet?.stats?.[id]?.value
      if (value !== undefined && value !== current) changedStats[id] = value
    }
    if (Object.keys(changedStats).length > 0) {
      changes.stats = changedStats as CharacterChanges['stats']
    }

    const changedSkills: Record<string, number> = {}
    for (const perk of sheet?.skills?.perks ?? []) {
      const value = numberOrUndefined(skills[perk.id] ?? '')
      if (value !== undefined && value !== perk.level) changedSkills[perk.id] = value
    }
    if (Object.keys(changedSkills).length > 0) changes.skills = changedSkills

    if (traitsAdd.length > 0) changes.traitsAdd = traitsAdd
    if (traitsRemove.length > 0) changes.traitsRemove = traitsRemove
    return changes
  }, [
    appearance,
    beardColor,
    beardModel,
    displayName,
    forename,
    hairColor,
    hairModel,
    profession,
    sheet,
    skinTexture,
    skills,
    stats,
    surname,
    traitsAdd,
    traitsRemove,
    weight,
  ])

  const handleSave = async () => {
    if (saving) return
    const changes = buildChanges()
    if (Object.keys(changes).length === 0) {
      toast({ title: t('character.edit.noChangesTitle'), description: t('character.edit.noChangesDesc') })
      return
    }
    setSaving(true)
    try {
      const result = await updateCharacter(username, changes)
      const failed = result.errors ?? []
      if (failed.length > 0) {
        toast({
          title: t('character.edit.savedPartialTitle'),
          description: t('character.edit.savedPartialDesc', { count: failed.length, detail: failed[0] }),
          variant: 'destructive',
        })
      } else {
        toast({ title: t('character.edit.savedTitle'), description: t('character.edit.savedDesc', { name: username }) })
      }
      onSaved?.()
      onOpenChange(false)
    } catch (error) {
      toast({
        title: t('character.edit.failedTitle'),
        description: getUserErrorMessage(error, t('character.edit.failedFallback')),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('character.edit.title', { name: username })}</DialogTitle>
          <DialogDescription>
            {t('character.edit.description')}
            {!online && ` ${t('character.edit.offline')}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-6 overflow-y-auto">
          {optionsLoading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {t('character.edit.loadingOptions')}
            </p>
          )}
          {options && !options.available && (
            <p className="text-xs text-muted-foreground">{t('character.edit.optionsUnavailable')}</p>
          )}

          {/* Identity */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('character.edit.identity')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="ce-forename">{t('character.edit.forename')}</Label>
                <Input id="ce-forename" value={forename} onChange={(e) => setForename(e.target.value)} maxLength={64} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-surname">{t('character.edit.surname')}</Label>
                <Input id="ce-surname" value={surname} onChange={(e) => setSurname(e.target.value)} maxLength={64} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-display">{t('character.edit.displayName')}</Label>
                <Input id="ce-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={64} />
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('character.edit.appearance')}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="ce-hair">{t('character.edit.hairModel')}</Label>
                <Input
                  id="ce-hair"
                  list="ce-hair-models"
                  value={hairModel}
                  placeholder={t('character.edit.hairModelPlaceholder')}
                  onChange={(e) => setHairModel(e.target.value)}
                />
                <datalist id="ce-hair-models">
                  {hairSuggestions.map((style) => (
                    <option key={style.name} value={style.name} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-hair-color">{t('character.edit.hairColor')}</Label>
                <Input
                  id="ce-hair-color"
                  type="color"
                  className="h-9 w-full p-1"
                  value={hairColor}
                  onChange={(e) => setHairColor(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-beard">{t('character.edit.beardModel')}</Label>
                <Input
                  id="ce-beard"
                  list="ce-beard-models"
                  value={beardModel}
                  placeholder={t('character.edit.beardModelPlaceholder')}
                  onChange={(e) => setBeardModel(e.target.value)}
                />
                <datalist id="ce-beard-models">
                  {beardSuggestions.map((style) => (
                    <option key={style.name} value={style.name} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-beard-color">{t('character.edit.beardColor')}</Label>
                <Input id="ce-beard-color" type="color" value={beardColor} onChange={(e) => setBeardColor(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-skin">{t('character.edit.skinTexture')}</Label>
                <Input
                  id="ce-skin"
                  type="number"
                  min={0}
                  value={skinTexture}
                  onChange={(e) => setSkinTexture(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ce-weight">{t('character.edit.weight')}</Label>
                <Input id="ce-weight" type="number" min={30} max={130} value={weight} onChange={(e) => setWeight(e.target.value)} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ce-profession">{t('character.edit.profession')}</Label>
                <Select value={profession || '__none'} onValueChange={(value) => setProfession(value === '__none' ? '' : value)}>
                  <SelectTrigger id="ce-profession">
                    <SelectValue placeholder={t('character.edit.professionPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('character.edit.professionNone')}</SelectItem>
                    {(options?.professions ?? []).map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label ?? option.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Condition stats */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('character.edit.stats')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {CHARACTER_STATS.map((id) => {
                const optionRange = options?.stats?.find((entry) => entry.id === id)
                const range = optionRange ?? sheet?.stats?.[id]
                const label = t(`character.condition.${id}`, { defaultValue: id })
                return (
                  <div key={id} className="space-y-1">
                    <Label htmlFor={`ce-stat-${id}`}>{label}</Label>
                    <Input
                      id={`ce-stat-${id}`}
                      type="number"
                      step="0.01"
                      min={range?.min}
                      max={range?.max}
                      value={stats[id] ?? ''}
                      onChange={(e) => setStats((prev) => ({ ...prev, [id]: e.target.value }))}
                    />
                  </div>
                )
              })}
            </div>
          </section>

          {/* Skills */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('character.edit.skills')}</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(sheet?.skills?.perks ?? []).map((perk) => (
                <div key={perk.id} className="space-y-1">
                  <Label htmlFor={`ce-skill-${perk.id}`}>{perk.name ?? perk.id}</Label>
                  <Input
                    id={`ce-skill-${perk.id}`}
                    type="number"
                    min={0}
                    max={10}
                    value={skills[perk.id] ?? ''}
                    onChange={(e) => setSkills((prev) => ({ ...prev, [perk.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Traits */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">{t('character.edit.traits')}</h3>
            <div className="flex flex-wrap gap-1.5">
              {currentTraitsList.map((trait) => {
                const removing = traitsRemove.includes(trait.id)
                return (
                  <button
                    key={trait.id}
                    type="button"
                    onClick={() => setTraitsRemove((prev) => (removing ? prev.filter((x) => x !== trait.id) : [...prev, trait.id]))}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                      removing ? 'border-destructive/60 text-destructive line-through' : 'border-border/60'
                    }`}
                    title={removing ? t('character.edit.traitUndoRemove') : t('character.edit.traitRemove')}
                  >
                    {trait.label ?? trait.id}
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )
              })}
              {traitsAdd.map((id) => {
                const option = options?.traits?.find((trait) => trait.id === id)
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTraitsAdd((prev) => prev.filter((x) => x !== id))}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-500/60 px-2 py-0.5 text-[11px] text-emerald-500"
                    title={t('character.edit.traitUndoAdd')}
                  >
                    +{option?.label ?? id}
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label htmlFor="ce-trait-add">{t('character.edit.traitsAdd')}</Label>
                <Select value={addChoice || '__none'} onValueChange={(value) => setAddChoice(value === '__none' ? '' : value)}>
                  <SelectTrigger id="ce-trait-add">
                    <SelectValue placeholder={t('character.edit.traitsAddPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('character.edit.traitsNone')}</SelectItem>
                    {(options?.traits ?? [])
                      .filter((option) => !currentTraitsList.some((trait) => trait.id === option.id) && !traitsAdd.includes(option.id))
                      .map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label ?? option.id}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="outline" onClick={() => { if (addChoice) setTraitsAdd((prev) => [...prev, addChoice]); setAddChoice('') }} disabled={!addChoice}>
                {t('character.edit.traitsAddButton')}
              </Button>
            </div>
          </section>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('character.edit.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? t('character.edit.saving') : t('character.edit.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
