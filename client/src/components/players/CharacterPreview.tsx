import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { Loader2, Shirt, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HelpTip } from '@/components/HelpTip'
import type { CharacterInventory, CharacterRow, CharacterSheet, CharacterColor } from '@/lib/characterApi'

// A live look at the selected character: a stylized figure drawn from the same
// HumanVisual data the game uses (skin tone, hair/beard style and colour), the
// descriptor facts beside it, and — once the inventory has been read — the
// clothes actually worn, with their condition. It is a paper-doll, not a
// sprite render: the panel has no access to the game's iso sprites, so the
// figure is a shape coloured from the character's real values and the "what he
// wears" is the worn-item list.

// Skin tones indexed by the game's skinTextureIndex. The game ships a fixed
// set; this is an approximation for the figure only — the swatch beside it
// shows the real index.
const SKIN_TONES = ['#f0c8a6', '#e6b48c', '#d9a074', '#c98a5c', '#b5744a', '#9c603c', '#7d4a2d', '#5f3721']

function toHex(color?: CharacterColor): string | null {
  if (color?.r === undefined || color?.g === undefined || color?.b === undefined) return null
  const part = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">{label}</dt>
      <dd className="truncate text-sm text-foreground/90">{children}</dd>
    </div>
  )
}

function Swatch({ color }: { color: string | null }) {
  if (!color) return <span className="text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-3 w-3 rounded-sm ring-1 ring-black/25" style={{ backgroundColor: color }} />
      <span className="font-mono text-[11px] uppercase text-muted-foreground">{color}</span>
    </span>
  )
}

/** Long hair (a style name that reads as long) gets side lengths; the rest is a cap. */
function hairIsLong(hairModel?: string): boolean {
  if (!hairModel) return false
  return /long|pony|braid|bob|tail|mohawk|sides|flow/i.test(hairModel)
}

function Figure({
  skin,
  hair,
  beard,
  isFemale,
}: {
  skin: string
  hair: string | null
  beard: string | null
  isFemale: boolean
}) {
  const shoulder = isFemale ? 40 : 44
  const torso = isFemale ? 100 : 96
  return (
    <svg viewBox="0 0 140 260" className="h-56 w-28 shrink-0" role="img" aria-hidden="true">
      {/* hair behind the head for long styles */}
      {hair && hairIsLong(hair) && (
        <>
          <rect x="48" y="44" width="7" height="58" rx="3.5" fill={hair} />
          <rect x="85" y="44" width="7" height="58" rx="3.5" fill={hair} />
        </>
      )}
      {/* legs and feet */}
      <rect x="52" y="148" width="15" height="86" rx="6" fill={skin} />
      <rect x="73" y="148" width="15" height="86" rx="6" fill={skin} />
      <ellipse cx="59" cy="240" rx="11" ry="6" fill={skin} />
      <ellipse cx="81" cy="240" rx="11" ry="6" fill={skin} />
      {/* arms */}
      <rect x="28" y="80" width="12" height="62" rx="6" fill={skin} />
      <rect x="100" y="80" width="12" height="62" rx="6" fill={skin} />
      <circle cx="34" cy="146" r="6" fill={skin} />
      <circle cx="106" cy="146" r="6" fill={skin} />
      {/* torso */}
      <path d={`M${shoulder} 78 Q70 70 ${140 - shoulder} 78 L${140 - torso / 2 + 4} 152 Q70 158 ${torso / 2 - 4} 152 Z`} fill={skin} />
      {/* neck and head */}
      <rect x="63" y="66" width="14" height="10" fill={skin} />
      <ellipse cx="70" cy="48" rx="19" ry="22" fill={skin} />
      {/* beard */}
      {beard && <path d="M54 56 C54 76 86 76 86 56 C81 68 59 68 54 56 Z" fill={beard} />}
      {/* hair (cap) */}
      {hair && <path d="M51 48 C51 24 89 24 89 48 C87 36 80 32 70 32 C60 32 53 36 51 48 Z" fill={hair} />}
    </svg>
  )
}

export function CharacterPreview({
  sheet,
  inventory,
  onLoad,
  canLoad,
  loading,
}: {
  sheet: CharacterSheet
  inventory: CharacterInventory | null
  /** Ask the page to read the inventory (needed for the worn-item list). */
  onLoad?: () => void
  canLoad?: boolean
  loading?: boolean
}) {
  const { t } = useTranslation('players')
  const appearance = sheet.summary?.appearance
  const skinIndex = appearance?.skinTextureIndex
  const skin = SKIN_TONES[typeof skinIndex === 'number' ? skinIndex % SKIN_TONES.length : 0]
  const hairColor = toHex(appearance?.hairColor)
  const beardColor = toHex(appearance?.beardColor)
  const hasHair = Boolean(appearance?.hairModel) && !/^bald$/i.test(appearance?.hairModel ?? '')

  const worn: CharacterRow[] = [...(inventory?.worn ?? [])]
  if (inventory?.equipped?.primary) worn.push(inventory.equipped.primary)
  if (inventory?.equipped?.secondary) worn.push(inventory.equipped.secondary)

  return (
    <section className="space-y-3" aria-labelledby="character-preview-heading">
      <h3 id="character-preview-heading" className="flex items-center gap-2 text-sm font-medium">
        <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
        {t('character.preview.title')}
        <HelpTip label={t('character.preview.title')}>{t('character.preview.tip')}</HelpTip>
      </h3>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex items-center justify-center rounded-md bg-muted/30 p-2 ring-1 ring-border/40">
          <Figure skin={skin} hair={hasHair ? hairColor ?? '#4a3728' : null} beard={beardColor} isFemale={appearance?.isFemale === true} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            <Fact label={t('character.preview.hair')}>
              {appearance?.hairModel ? (
                <span className="font-mono text-xs">{appearance.hairModel}</span>
              ) : (
                <span className="text-muted-foreground">{t('character.preview.none')}</span>
              )}
            </Fact>
            <Fact label={t('character.preview.hairColor')}>
              <Swatch color={hairColor} />
            </Fact>
            <Fact label={t('character.preview.beard')}>
              {appearance?.beardModel && !/^none$/i.test(appearance.beardModel) ? (
                <span className="font-mono text-xs">{appearance.beardModel}</span>
              ) : (
                <span className="text-muted-foreground">{t('character.preview.none')}</span>
              )}
            </Fact>
            <Fact label={t('character.preview.beardColor')}>
              <Swatch color={beardColor} />
            </Fact>
            <Fact label={t('character.preview.skin')}>
              <span className="font-mono text-xs">{typeof skinIndex === 'number' ? skinIndex : '—'}</span>
            </Fact>
            <Fact label={t('character.preview.gender')}>
              {appearance?.isFemale === true
                ? t('character.preview.female')
                : appearance?.isFemale === false
                  ? t('character.preview.male')
                  : '—'}
            </Fact>
            <Fact label={t('character.preview.weight')}>
              <span className="font-mono text-xs tabular-nums">
                {typeof sheet.summary?.bodyWeight === 'number' ? sheet.summary.bodyWeight.toFixed(1) : '—'}
              </span>
            </Fact>
          </dl>

          <div className="space-y-2 border-t border-border/40 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                <Shirt className="h-3.5 w-3.5" aria-hidden="true" />
                {t('character.preview.worn')}
              </span>
              {worn.length === 0 && canLoad && onLoad && (
                <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onLoad} disabled={loading}>
                  {loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  {t('character.preview.loadWorn')}
                </Button>
              )}
            </div>
            {worn.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {worn.map((item, index) => {
                  const stack = item.kind === 'stack' ? item : null
                  return (
                    <li key={`${item.fullType ?? item.name ?? 'item'}-${index}`}>
                      <Badge variant="outline" className="gap-1 font-normal text-[11px]">
                        {item.name ?? item.fullType ?? '—'}
                        {stack && typeof stack.condition === 'number' && stack.conditionMax ? (
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                            {Math.round(stack.condition)}/{Math.round(stack.conditionMax)}
                          </span>
                        ) : null}
                      </Badge>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">{t('character.preview.wornEmpty')}</p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
