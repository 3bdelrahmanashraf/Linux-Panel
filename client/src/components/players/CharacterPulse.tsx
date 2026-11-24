import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, LineChart as LineChartIcon } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { HelpTip } from '@/components/HelpTip'
import {
  CHARACTER_STATS,
  type CharacterSheet,
  type CharacterStatName,
  type CharacterStatSample,
} from '@/lib/characterApi'
import { formatTime, formatWhen } from './characterFormat'

// The Character tab's live "pulse": the Condition numbers the panel has been
// reading, drawn over time like the PZ Pulse mod's HUD. Every series is
// normalized to its own range (the bridge sends each stat's min/max, so the
// chart is a percentage, not a guessed scale) and shown on one 0-100% axis.
// Samples come from the store's statHistory: each sheet read while the tab is
// open appends one, so the chart grows as you watch.

const PALETTE = [
  '#4ade80',
  '#38bdf8',
  '#f5c542',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#e8552d',
  '#84cc16',
  '#eab308',
  '#06b6d4',
  '#f97316',
  '#94a3b8',
]

// Hunger, thirst and fatigue are 0-1 in the game (vanilla Lua compares them
// with thresholds like FATIGUE <= 0.3); nothing else is assumed when a stat
// arrives without a range.
const UNIT_RANGE_STATS = new Set<CharacterStatName>(['hunger', 'thirst', 'fatigue'])
// On by default: the numbers a player actually watches.
const DEFAULT_ON = ['health', 'endurance', 'fatigue', 'hunger', 'thirst', 'stress']

interface PulseSeries {
  key: string
  label: string
  color: string
  min: number
  max: number
}

function windowOf(from: number, to: number): string {
  const seconds = Math.max(0, Math.round((to - from) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

export function CharacterPulse({
  sheet,
  history,
  savedAt,
}: {
  sheet: CharacterSheet
  /** Condition samples, oldest first; empty until the sheet has been read twice. */
  history: CharacterStatSample[]
  /** A saved Condition read earlier than the rest of the saved sheet: when. */
  savedAt?: string | null
}) {
  const { t, i18n } = useTranslation('players')
  const language = i18n.language
  const [enabled, setEnabled] = useState<Record<string, boolean>>({})

  // A series only appears when the history actually carries it and its range
  // can be resolved, so an old bridge (no ranges) doesn't plot a fake 0-100.
  const series = useMemo<PulseSeries[]>(() => {
    const list: PulseSeries[] = []
    if (history.some((sample) => typeof sample.health === 'number')) {
      list.push({ key: 'health', label: t('character.condition.health'), color: PALETTE[0], min: 0, max: 100 })
    }
    for (const name of CHARACTER_STATS) {
      if (!history.some((sample) => typeof sample.values?.[name] === 'number')) continue
      const stat = sheet.stats?.[name]
      let min: number
      let max: number
      if (stat && typeof stat.min === 'number' && typeof stat.max === 'number' && stat.max > stat.min) {
        min = stat.min
        max = stat.max
      } else if (UNIT_RANGE_STATS.has(name)) {
        min = 0
        max = 1
      } else {
        continue
      }
      list.push({
        key: name,
        label: t(`character.condition.${name}`),
        color: PALETTE[list.length % PALETTE.length],
        min,
        max,
      })
    }
    return list
  }, [history, sheet, t])

  const isOn = (key: string) => enabled[key] ?? DEFAULT_ON.includes(key)

  const data = useMemo(
    () =>
      history.map((sample) => {
        const row: Record<string, number | null> = { t: sample.at }
        for (const s of series) {
          const raw = s.key === 'health' ? sample.health : sample.values?.[s.key as CharacterStatName]
          row[s.key] =
            typeof raw === 'number' && s.max > s.min
              ? Math.max(0, Math.min(100, ((raw - s.min) / (s.max - s.min)) * 100))
              : null
        }
        return row
      }),
    [history, series],
  )

  const window = data.length > 1 ? windowOf(data[0].t as number, data[data.length - 1].t as number) : null
  const activeSeries = series.filter((s) => isOn(s.key))

  return (
    <section className="space-y-3" aria-labelledby="character-pulse-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="character-pulse-heading" className="flex items-center gap-2 text-sm font-medium">
          <LineChartIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          {t('character.pulse.title')}
          <HelpTip label={t('character.pulse.title')}>{t('character.pulse.tip')}</HelpTip>
        </h3>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {savedAt ? (
            <span>{t('character.state.savedAt', { when: formatWhen(savedAt, language) })}</span>
          ) : (
            data.length > 1 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                {t('character.pulse.live')}
              </span>
            )
          )}
          {window && <span className="font-mono tabular-nums">{t('character.pulse.window', { window })}</span>}
        </div>
      </div>

      {data.length < 2 ? (
        <p className="text-xs text-muted-foreground">{t('character.pulse.collecting')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {series.map((s) => {
              const on = isOn(s.key)
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setEnabled((prev) => ({ ...prev, [s.key]: !on }))}
                  aria-pressed={on}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    on ? 'border-border/70 text-foreground/90' : 'border-border/40 text-muted-foreground/60'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: s.color, opacity: on ? 1 : 0.35 }}
                  />
                  {s.label}
                </button>
              )
            })}
          </div>
          {activeSeries.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('character.pulse.noneSelected')}</p>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                  <XAxis
                    dataKey="t"
                    tickFormatter={(value) => formatTime(Number(value), language)}
                    tick={{ fontSize: 10 }}
                    minTickGap={44}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                    tick={{ fontSize: 10 }}
                    width={44}
                    stroke="hsl(var(--muted-foreground))"
                  />
                  <Tooltip
                    labelFormatter={(label) => formatTime(Number(label), language)}
                    formatter={(value, name) => [`${typeof value === 'number' ? Math.round(value) : 0}%`, String(name)]}
                    contentStyle={{
                      background: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                  />
                  {series.map((s) => (
                    <Line
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={s.color}
                      strokeWidth={1.6}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls
                      hide={!isOn(s.key)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {sheet.sectionErrors?.stats && (
        <p className="text-xs text-muted-foreground">{t('character.state.sectionFailed', { reason: sheet.sectionErrors.stats })}</p>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Activity className="h-3 w-3" aria-hidden="true" />
        {t('character.pulse.footer')}
      </p>
    </section>
  )
}
