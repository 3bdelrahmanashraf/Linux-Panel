import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState, useContext } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  LayoutDashboard,
  Gauge,
  Users,
  Trophy,
  Terminal,
  Clock,
  Package,
  PackageMinus,
  FileArchive,
  Settings,
  Server,
  Download,
  Bug,
  Map,
  Eraser,
  MessageSquare,
  Smartphone,
  Layers,
  ChevronDown,
  FileCog,
  FolderTree,
  LayoutTemplate,
  Menu,
  X,
  Search,
  Zap,
  MessagesSquare,
  Archive,
  AlertCircle,
  RefreshCw,
  Github,
  LogOut,
  UserCog,
  ShieldCheck,
  KeyRound
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ConnectionStatus, ConnectionAnnouncer } from './ConnectionStatus'
import { SystemHealthBanner } from './SystemHealthBanner'
import { serversApi, ServerInstance, updateApi, UpdateStatus, serverApi, modsApi, panelUpdateApi } from '@/lib/api'
import { resolveClientProvider } from '@/lib/serverStatus'
import { getResultErrorMessage } from '@/lib/errorMessage'
import { SocketContext } from '@/contexts/SocketContext'

import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/ui/use-toast'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'
import { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp'
import { preloadRouteModule } from '@/lib/routePreload'
import { LanguageSwitcher } from './LanguageSwitcher'
import { REPO_URL } from '@/lib/supportLinks'

// Standalone top-level nav item (not collapsible). `labelKey` resolves
// against the `shell` namespace; kept separate from `label` (English,
// used for tooltip fallbacks/aria where a plain string is simpler to thread
// through) so translation is additive rather than replacing the data shape.
const dashboardItem = { to: '/', icon: Gauge, label: 'Dashboard', labelKey: 'nav.dashboard' }

interface NavItem {
  to: string
  icon: typeof LayoutDashboard
  label: string
  labelKey: string
  requiresLocal?: boolean
  // Still reachable on a remote server once its Server folder is mirrored over SFTP.
  allowRemoteConfigMirror?: boolean
  disabled?: boolean
  badge?: string
  // Item-level (not section-level, see below): needs a configured server to
  // mean anything (live status, config, scheduled maintenance, ...). A
  // section can freely mix requiresServer and non-requiresServer items now
  // that grouping is by OBJECT (Server/World/Users/Panel) rather than by
  // "does this need a server" -- e.g. SERVER holds both My Servers (works
  // at zero servers, it's how you get one) and Server Console (needs one).
  requiresServer?: boolean
  // Hides the item entirely (not just disables it) unless can(capability)
  // is true -- mirrors how Settings.tsx already hides its own users/roles/
  // sso tabs for a role lacking the matching capability (can() fails OPEN
  // while capabilities are still loading, same as there).
  capability?: string
}

interface NavSection {
  id: string
  label: string
  labelKey: string
  icon: typeof LayoutDashboard
  color: string
  items: NavItem[]
}

// Navigation sections with collapsible groups. Restructured 2026-09-18 per
// the operator's navigation contract (2026-08-19): group by OBJECT --
// SERVER / WORLD / USERS / PANEL -- Project Zomboid vocabulary, dense by
// default. Previously grouped by "how fresh is this" (Live/Config/Maintain)
// which split same-object items (e.g. Server Console and Server
// Configuration) across different sections.
const navSections: NavSection[] = [
  {
    id: 'server',
    label: 'Server',
    labelKey: 'nav.sections.server',
    icon: Server,
    color: 'cyan',
    items: [
      { to: '/servers', icon: Layers, label: 'My Servers', labelKey: 'nav.items.myServers' },
      { to: '/console', icon: Terminal, label: 'Server Console', labelKey: 'nav.items.serverConsole', requiresServer: true },
      { to: '/server-config', icon: FileCog, label: 'Server Configuration', labelKey: 'nav.items.serverConfiguration', requiresServer: true, requiresLocal: true, allowRemoteConfigMirror: true },
      // Remote servers too: their folders are browsed over the PanelBridge SFTP login.
      { to: '/files', icon: FolderTree, label: 'Server Files', labelKey: 'nav.items.serverFiles', requiresServer: true, capability: 'files.manage' },
      { to: '/mods', icon: Package, label: 'Mod Manager', labelKey: 'nav.items.modManager', requiresServer: true, requiresLocal: true },
      { to: '/optional-mods', icon: PackageMinus, label: 'Optional Mods', labelKey: 'nav.items.optionalMods', requiresServer: true, requiresLocal: true },
      { to: '/export-mods', icon: FileArchive, label: 'Export Mods', labelKey: 'nav.items.exportMods', requiresServer: true, requiresLocal: true },
      { to: '/scheduler', icon: Clock, label: 'Scheduled Tasks', labelKey: 'nav.items.scheduledTasks', requiresServer: true },
      { to: '/server-setup', icon: Download, label: 'Server Setup', labelKey: 'nav.items.serverSetup' },
      { to: '/server-finder', icon: Search, label: 'Browse Public Servers', labelKey: 'nav.items.browsePublic' },
    ]
  },
  {
    id: 'world',
    label: 'World',
    labelKey: 'nav.sections.world',
    icon: Map,
    color: 'amber',
    items: [
      { to: '/world-map', icon: Map, label: 'World Map', labelKey: 'nav.items.worldMap', requiresServer: true },
      { to: '/events', icon: Zap, label: 'Events & Weather', labelKey: 'nav.items.eventsWeather', requiresServer: true },
      { to: '/backups', icon: Archive, label: 'World Backups', labelKey: 'nav.items.worldBackups', requiresServer: true, requiresLocal: true },
      { to: '/chunks', icon: Eraser, label: 'Map Cleanup', labelKey: 'nav.items.mapCleanup', requiresServer: true, requiresLocal: true },
      { to: '/templates', icon: LayoutTemplate, label: 'Templates', labelKey: 'nav.items.templates', requiresServer: true, requiresLocal: true, allowRemoteConfigMirror: true },
    ]
  },
  {
    id: 'users',
    label: 'Users',
    labelKey: 'nav.sections.users',
    icon: Users,
    color: 'emerald',
    items: [
      { to: '/players', icon: Users, label: 'Online Players', labelKey: 'nav.items.onlinePlayers', requiresServer: true },
      { to: '/leaderboard', icon: Trophy, label: 'Leaderboard', labelKey: 'nav.items.leaderboard', requiresServer: true },
      { to: '/chat', icon: MessagesSquare, label: 'In-Game Chat', labelKey: 'nav.items.inGameChat', requiresServer: true },
      // Panel Users/Roles & Permissions/Single Sign-On: no dedicated route
      // (route paths must stay stable) -- these point straight at the same
      // Settings tabs /users, /roles and /sso already redirect to
      // (App.tsx), and are gated on the exact capability that hides the
      // matching Settings tab (Settings.tsx's settingsSections filter).
      { to: '/settings?tab=users', icon: UserCog, label: 'Panel Users', labelKey: 'nav.items.panelUsers', capability: 'users.manage' },
      { to: '/settings?tab=roles', icon: ShieldCheck, label: 'Roles & Permissions', labelKey: 'nav.items.rolesPermissions', capability: 'roles.manage' },
      { to: '/settings?tab=sso', icon: KeyRound, label: 'Single Sign-On', labelKey: 'nav.items.singleSignOn', capability: 'panel.settings' },
    ]
  },
  {
    id: 'panel',
    label: 'Panel',
    labelKey: 'nav.sections.panel',
    icon: Settings,
    color: 'slate',
    items: [
      { to: '/settings', icon: Settings, label: 'Panel Settings', labelKey: 'nav.items.panelSettings' },
      { to: '/discord', icon: MessageSquare, label: 'Discord', labelKey: 'nav.items.discord' },
      { to: '/messages', icon: Smartphone, label: 'Messages', labelKey: 'nav.items.messages' },
      { to: '/debug', icon: Bug, label: 'Debug Logs', labelKey: 'nav.items.debugLogs' },
    ]
  },
]

const sectionToneStyles = {
  emerald: {
    triggerActive: 'bg-success/12 border-success/35',
    iconActive: 'border-success/45 bg-success/14 text-success',
    iconIdle: 'text-foreground/86 group-hover:text-success',
    labelActive: 'text-success',
    childActive: 'border-success/45 bg-success/10',
    childDot: 'bg-success',
    childBorder: 'border-success/35',
  },
  amber: {
    triggerActive: 'bg-warning/12 border-warning/35',
    iconActive: 'border-warning/45 bg-warning/14 text-warning',
    iconIdle: 'text-foreground/86 group-hover:text-warning',
    labelActive: 'text-warning',
    childActive: 'border-warning/45 bg-warning/10',
    childDot: 'bg-warning',
    childBorder: 'border-warning/35',
  },
  cyan: {
    triggerActive: 'bg-primary/14 border-primary/35',
    iconActive: 'border-primary/45 bg-primary/16 text-primary',
    iconIdle: 'text-foreground/86 group-hover:text-primary',
    labelActive: 'text-primary',
    childActive: 'border-primary/45 bg-primary/10',
    childDot: 'bg-primary',
    childBorder: 'border-primary/35',
  },
  slate: {
    triggerActive: 'bg-muted/45 border-border/70',
    iconActive: 'border-border/80 bg-muted text-foreground',
    iconIdle: 'text-foreground/86 group-hover:text-foreground',
    labelActive: 'text-foreground',
    childActive: 'border-border/80 bg-muted/60',
    childDot: 'bg-muted-foreground',
    childBorder: 'border-border/70',
  },
  destructive: {
    triggerActive: 'bg-destructive/12 border-destructive/35',
    iconActive: 'border-destructive/45 bg-destructive/14 text-destructive',
    iconIdle: 'text-foreground/86 group-hover:text-destructive',
    labelActive: 'text-destructive',
    childActive: 'border-destructive/45 bg-destructive/10',
    childDot: 'bg-destructive',
    childBorder: 'border-destructive/35',
  },
} as const

// Auth footer — shows logged-in user and logout button
// One size for every icon control in the sidebar footer, so the account row
// and the toolbar row line up and each target stays comfortably tappable.
// Same idle colour and warm hover as the nav rows.
const FOOTER_ICON_BUTTON =
  'grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function AuthFooter() {
  const { t } = useTranslation('shell')
  const { user, authEnabled, logout } = useAuth()

  if (!authEnabled || !user) return null

  // The footer's account row: who is signed in, and the way out at the far
  // edge. The monogram anchors the row; the name truncates before the
  // button does.
  return (
    <div className="flex min-h-7 items-center gap-2">
      <span
        aria-hidden="true"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-border/40 bg-muted/40 font-mono text-[11px] font-semibold uppercase text-foreground/80"
      >
        {user.username.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/85" title={user.username}>
        {user.username}
      </span>
      <button
        type="button"
        onClick={logout}
        className={FOOTER_ICON_BUTTON}
        aria-label={t('footer.signOut')}
        title={t('footer.signOut')}
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// Tap-to-open touch fix for a disabled nav row's reason tooltip --
// impeccable-critique-2026-08-31: Radix's TooltipTrigger closes on its own
// click handler by default (built for hover, where a click is a dismiss
// gesture), which is useless for touch: there's no hover to open it in the
// first place. HelpTip.tsx already solved this exact problem (see its own
// comment) with a controlled `open` state + preventDefault() on click to
// block Radix's built-in close so the same tap opens it instead. A disabled
// nav row has no navigation for a tap to conflict with, so the same fix is
// free here -- unlike the enabled NavLink row below it, whose tap must keep
// navigating and is deliberately NOT wrapped in this.
function DisabledNavTooltip({ side = 'right', reason, children }: {
  side?: 'top' | 'right' | 'bottom' | 'left'
  reason: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild onClick={(event) => { event.preventDefault(); setOpen(true) }}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{reason}</TooltipContent>
    </Tooltip>
  )
}

function PanelBrand({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation('shell')
  return (
    <div className={cn("flex items-center", compact ? "gap-2" : "gap-2.5")}>
      <img
        src={`${import.meta.env.BASE_URL}spiffo.png`}
        alt="Spiffo"
        loading="lazy"
        width={compact ? 28 : 34}
        height={compact ? 28 : 34}
        className={cn(
          compact ? "h-7 w-7" : "h-[34px] w-[34px]",
          "object-contain drop-shadow-sm saturate-90"
        )}
      />
      <div className="min-w-0">
        <p
          className={cn(
            "shell-brand-title truncate uppercase leading-tight",
            compact ? "text-[13px] tracking-[0.12em]" : "text-sm tracking-[0.14em]"
          )}
        >
          {t('brand.title')}
        </p>
        <p
          className={cn(
            "shell-brand-subtitle truncate text-muted-foreground leading-tight",
            "text-[11px] mt-0.5"
          )}
        >
          // {t('brand.subtitle')}
        </p>
      </div>
    </div>
  )
}

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const { t } = useTranslation('shell')
  const { t: tScheduler } = useTranslation('scheduler')
  const { t: tMods } = useTranslation('mods')
  const [activeServer, setActiveServer] = useState<ServerInstance | null>(null)

  const isBlockedByRemote = (item: NavItem) =>
    !!item.requiresLocal &&
    !!activeServer?.isRemote &&
    !(item.allowRemoteConfigMirror && activeServer.remoteConfigConfigured)
  const provider = resolveClientProvider(activeServer)
  // null = we don't yet know (still loading, or the last fetch failed) — distinct
  // from [] (fetch succeeded and confirmed there really are zero servers). Collapsing
  // those into one empty array made a slow/failed fetch render the same "no server
  // yet" claim as a genuinely empty roster, on every load and permanently on failure.
  const [servers, setServers] = useState<ServerInstance[] | null>(null)
  const serversConfirmedEmpty = servers !== null && servers.length === 0
  const isBlockedByNoServer = (item: NavItem) => !!item.requiresServer && serversConfirmedEmpty
  const { can } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Not a Radix primitive, so it gets none of Radix's automatic focus
  // trap/restore -- handled manually below.
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const [updateInfo, setUpdateInfo] = useState<UpdateStatus | null>(null)
  // Persist dismissal across reloads, but key it by build IDs so a NEW update
  // re-shows the banner. Was sessionStorage which got cleared on browser restart.
  const [updateDismissed, setUpdateDismissed] = useState(false)
  const [playerCount, setPlayerCount] = useState<number>(0)
  const [serverRunState, setServerRunState] = useState<'unknown' | 'running' | 'stopped' | 'transitioning' | 'unresponsive'>('unknown')
  const [modUpdatesAvailable, setModUpdatesAvailable] = useState<number>(0)
  const [panelUpdateAvailable, setPanelUpdateAvailable] = useState<{ version: string | null } | null>(null)
  const [panelVersion, setPanelVersion] = useState('')
  // The server's version, else this build's, so the footer never shows "v—".
  const displayVersion = panelVersion || (typeof __PANEL_VERSION__ !== 'undefined' ? __PANEL_VERSION__ : '')
  const socket = useContext(SocketContext)
  const { toast } = useToast()
  const { helpOpen, setHelpOpen, shortcuts } = useKeyboardShortcuts()

  // Fetch panel version
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then(r => r.json())
      .then(d => { if (!cancelled && d.version) setPanelVersion(d.version) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Listen for player updates globally
  useEffect(() => {
    if (!socket) return

    const handlePlayersUpdate = (players: unknown) => {
      setPlayerCount(Array.isArray(players) ? players.length : 0)
    }

    socket.on('players:update', handlePlayersUpdate)
    return () => {
      socket.off('players:update', handlePlayersUpdate)
    }
  }, [socket])

  // Surface the REAL outcome of a manual restart or "Run now" task, from
  // wherever the user happens to be -- not just on the Scheduler page.
  // POST /restart-now and /tasks/:id/run only ever confirmed the action was
  // ACCEPTED (both run in the background and used to report success:true
  // unconditionally); this is the one place the actual result reaches the
  // client at all instead of only being discoverable by someone who thinks
  // to go check Schedule History (2026-08-26 bug hunt, scheduler
  // blind-success family). Global, not page-scoped, because a restart's
  // countdown + graceful shutdown can run long enough that the user has
  // already navigated elsewhere by the time it resolves.
  //
  // A failure can carry a registered error code and its params (the server's
  // codedActionResultFields(), today SERVER_START_SCRIPT_MISSING and
  // SERVER_RESTART_SCRIPT_MISSING from GH #167, and SERVER_START_GAME_PORT_IN_USE),
  // shown translated like POST /api/server/start's own refusal; the English
  // message is the fallback.
  useEffect(() => {
    if (!socket) return
    const onActionResult = (data?: { kind?: 'restart' | 'task'; taskName?: string; success?: boolean; message?: string; code?: string; params?: unknown }) => {
      if (!data) return
      const isRestart = data.kind === 'restart'
      const title = data.success
        ? (isRestart ? tScheduler('toasts.restartSucceededTitle') : tScheduler('toasts.taskSucceededTitle', { name: data.taskName }))
        : (isRestart ? tScheduler('toasts.restartResultFailedTitle') : tScheduler('toasts.taskResultFailedTitle', { name: data.taskName }))
      toast({
        title,
        description: !data.success && data.code
          ? getResultErrorMessage({ code: data.code, params: data.params, error: data.message }, data.message ?? '')
          : data.message,
        variant: data.success ? ('success' as const) : 'destructive',
      })
    }
    socket.on('scheduler:action_result', onActionResult)
    return () => {
      socket.off('scheduler:action_result', onActionResult)
    }
  }, [socket, tScheduler, toast])

  // GH #189: a mod-update restart that was waiting for players ends when the
  // server is started again after the update (the new start loaded the
  // updated mods). Global like the restart result above: the operator
  // usually restarted from the Dashboard, not the Mods page, and this says
  // why the pending restart they were told about won't happen. An operator's
  // own Cancel on the Mods page carries no reason and stays silent here.
  useEffect(() => {
    if (!socket) return
    const onRestartCancelled = (data?: { reason?: string }) => {
      if (data?.reason !== 'server_restarted') return
      toast({
        title: tMods('restartPending.cancelledByRestartTitle'),
        description: tMods('restartPending.cancelledByRestartDesc'),
      })
    }
    socket.on('mods:restart_cancelled', onRestartCancelled)
    return () => {
      socket.off('mods:restart_cancelled', onRestartCancelled)
    }
  }, [socket, tMods, toast])

  const navigate = useNavigate()
  const location = useLocation()
  const playerCountLabel = playerCount > 99 ? '99+' : String(playerCount)

  // Panel Users/Roles & Permissions/Single Sign-On (USERS section) link
  // straight into Settings' own tabs via ?tab=, so a plain pathname-only
  // active match (react-router's NavLink default) would light up every
  // /settings-linked row -- including the plain Panel Settings entry --
  // together whenever any one of them is open. Resolve the real tab from
  // location.search and match on that for any item whose `to` carries one;
  // the plain /settings entry is active only when the open tab isn't one of
  // those three (otherwise it'd stay lit alongside them).
  const settingsSubTabIds = ['users', 'roles', 'sso']
  const currentSettingsTab = location.pathname === '/settings'
    ? new URLSearchParams(location.search).get('tab')
    : null
  const isItemActive = (item: NavItem) => {
    const [itemPath, itemQuery] = item.to.split('?')
    if (location.pathname !== itemPath) return false
    if (!itemQuery) {
      return itemPath !== '/settings' || !currentSettingsTab || !settingsSubTabIds.includes(currentSettingsTab)
    }
    const itemTab = new URLSearchParams(itemQuery).get('tab')
    return itemTab != null && itemTab === currentSettingsTab
  }

  // Track server run state for the status dot on the Active Server card.
  //
  // GH#114: status.running (from serverApi.getStatus(), and the raw payload
  // pushed on the 'server:status' socket event) is a LOCAL process scan --
  // it can only ever see a process on/in this host/container. That's a
  // trustworthy, freshest signal for a native server, but a docker-managed
  // server's PZ process runs in a *different* container the scan can't see
  // at all, and a remote-sftp server isn't on this host to begin with. This
  // dot used to trust the raw scan unconditionally for every provider (not
  // even gated on isRemote, unlike the Dashboard's equivalent bug) -- a
  // Docker container correctly shown running by the Docker panel could
  // still read "stopped" here, in the sidebar, on every single page.
  // Non-native providers now read the provider-aware composed status
  // instead (server/utils/serverStatusModel.js's 3-signal model), the same
  // source Dashboard.tsx and Servers.tsx's active-server card already use.
  const refreshServerRunState = useCallback(async () => {
    if (provider === 'native') {
      try {
        const data = await serverApi.getStatus() as { running?: boolean; scanFailed?: boolean } | undefined
        // scanFailed (serverManager.js's getServerStatus(), same field
        // Dashboard.tsx's deriveDashboardStatus already excludes for this
        // exact reason) means the scan itself couldn't tell, not that it
        // confirmed stopped -- this dot used to collapse that into a
        // confident 'stopped' in the sidebar, on every page (2026-09-08
        // three-state audit).
        if (data?.scanFailed) { setServerRunState('unknown'); return }
        if (typeof data?.running === 'boolean') setServerRunState(data.running ? 'running' : 'stopped')
      } catch { /* transient fetch failure -- keep the last known state */ }
      return
    }
    if (provider == null) { setServerRunState('unknown'); return }
    try {
      const composed = await serversApi.getComposedStatus()
      const hostRunning = composed.host.status === 'running'
      const rconConnected = composed.server.status === 'connected'
      const bridgeActive = composed.bridge.status === 'active'
      const hostUnknown = ['unknown', 'not-applicable'].includes(composed.host.status)
      setServerRunState(
        hostRunning || rconConnected || bridgeActive ? 'running' : hostUnknown ? 'unknown' : 'stopped',
      )
    } catch {
      setServerRunState('unknown')
    }
  }, [provider])

  useEffect(() => {
    // Depends on activeServer?.id (not just refreshServerRunState) so
    // switching between two servers with the SAME provider -- native to
    // native, say -- still refetches; provider alone wouldn't change in
    // that case. No stale-response guard: a slower in-flight request
    // landing after a newer one could briefly overwrite it with an older
    // value, the same tolerance the previous version of this effect had.
    // Acceptable for a sidebar dot that self-corrects on the next
    // poll/socket event.
    void refreshServerRunState()
  }, [activeServer?.id, refreshServerRunState])

  useEffect(() => {
    if (!socket) return
    const onStatus = (data?: {
      running?: boolean
      isRunning?: boolean
      phase?: 'starting' | 'running' | 'stopped' | 'unresponsive' | 'unknown'
    }) => {
      // Fast path: for a native server, a pushed boolean is as trustworthy
      // as a fresh fetch and avoids a round trip. Everything else needs the
      // composed status to know what the push actually means.
      if (provider === 'native') {
        // `phase` refines the raw boolean for exactly the window a bare
        // running:true used to lie about (host process up, RCON not
        // connected yet -- 2026-09-07, the "STARTING state" gap). Source of
        // truth: resolveServerPhase() in server/utils/serverStatus.js.
        // Display-only -- it never gates anything, only which dot/label
        // renders. Falls back to the plain boolean when phase is absent.
        if (data?.phase === 'starting') { setServerRunState('transitioning'); return }
        if (data?.phase === 'unresponsive') { setServerRunState('unresponsive'); return }
        const running = typeof data?.running === 'boolean' ? data.running : data?.isRunning
        if (typeof running === 'boolean') { setServerRunState(running ? 'running' : 'stopped'); return }
      }
      void refreshServerRunState()
    }
    socket.on('server:status', onStatus)
    return () => { socket.off('server:status', onStatus) }
  }, [socket, provider, refreshServerRunState])

  // Track mod updates available count for Mod Manager nav badge
  useEffect(() => {
    let cancelled = false
    const refreshModStatus = async () => {
      try {
        const data = await modsApi.getStatus() as { updatesAvailable?: number } | undefined
        if (!cancelled && typeof data?.updatesAvailable === 'number') {
          setModUpdatesAvailable(data.updatesAvailable)
        }
      } catch {
        // ignore — likely 503 / not running
      }
    }
    refreshModStatus()
    if (!socket) return () => { cancelled = true }
    socket.on('mods:updates_available', refreshModStatus)
    socket.on('mods:update_detected', refreshModStatus)
    return () => {
      cancelled = true
      socket.off('mods:updates_available', refreshModStatus)
      socket.off('mods:update_detected', refreshModStatus)
    }
  }, [socket, activeServer?.id])

  // Track panel self-update availability (separate from PZ server update)
  useEffect(() => {
    let cancelled = false
    panelUpdateApi.getStatus()
      .then(s => {
        if (cancelled) return
        if (s?.updateAvailable) setPanelUpdateAvailable({ version: s.latestVersion })
        else setPanelUpdateAvailable(null)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  // Close the pop-up list with Escape for keyboard users, restoring focus to
  // the More button -- an explicit dismissal, unlike the route-change effect
  // above (there, focus should follow the navigation, not jump backwards).
  useEffect(() => {
    if (!mobileMenuOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      // A popover or menu inside the sheet handles its own Escape (Radix
      // marks it defaultPrevented); only the next one closes the sheet.
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setMobileMenuOpen(false)
        mobileMenuButtonRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileMenuOpen])

  // Move focus into the sheet when it opens -- this is a hand-rolled
  // overlay (not a Radix Dialog), so it gets none of Radix's automatic
  // focus trap. Without this, focus stays on the More button behind it.
  useEffect(() => {
    if (!mobileMenuOpen) return
    const firstFocusable = mobileMenuRef.current?.querySelector<HTMLElement>(
      'a[href], button:not([disabled])'
    )
    firstFocusable?.focus()
  }, [mobileMenuOpen])

  // Prevent background scroll while mobile menu is open
  useEffect(() => {
    const { body } = document
    const previousOverflow = body.style.overflow
    if (mobileMenuOpen) {
      body.style.overflow = 'hidden'
    }

    return () => {
      body.style.overflow = previousOverflow
    }
  }, [mobileMenuOpen])

  // Fetch servers and active server
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch {
        toast({
          title: t('serverListErrors.listUnavailableTitle'),
          description: t('serverListErrors.listUnavailableDesc'),
          variant: 'destructive',
        })
      }
    }
    fetchServers()
  }, [toast, t])

  // Listen for server changes
  useEffect(() => {
    if (!socket) return

    const handleActiveServerChanged = async () => {
      try {
        const data = await serversApi.getAll()
        setServers(data.servers || [])
        const active = data.servers?.find((s: ServerInstance) => s.isActive) || null
        setActiveServer(active)
      } catch {
        toast({
          title: t('serverListErrors.refreshFailedTitle'),
          description: t('serverListErrors.refreshFailedDesc'),
          variant: 'destructive',
        })
      }
    }

    socket.on('activeServerChanged', handleActiveServerChanged)
    return () => {
      socket.off('activeServerChanged', handleActiveServerChanged)
    }
  }, [socket, toast, t])

  // Listen for update notifications
  useEffect(() => {
    if (!socket) return

    const handleUpdateAvailable = (data: UpdateStatus) => {
      setUpdateInfo(data)
      // Show banner again when a different update is detected
      const dismissedKey = data?.installed && data?.latest
        ? `updateBannerDismissed:${data.installed.buildId}->${data.latest.buildId}`
        : null
      setUpdateDismissed(!!dismissedKey && localStorage.getItem(dismissedKey) === 'true')
    }

    const handleUpdateCheck = (data: UpdateStatus) => {
      if (data.updateAvailable) {
        setUpdateInfo(data)
      } else {
        setUpdateInfo(null)
      }
    }

    socket.on('server:updateAvailable', handleUpdateAvailable)
    socket.on('server:updateCheck', handleUpdateCheck)

    // Check for updates on mount
    updateApi.getStatus().then(status => {
      if (status.updateAvailable?.updateAvailable) {
        setUpdateInfo(status.updateAvailable)
      }
    }).catch(() => {})

    return () => {
      socket.off('server:updateAvailable', handleUpdateAvailable)
      socket.off('server:updateCheck', handleUpdateCheck)
    }
  }, [socket])

  const handleSwitchServer = async (server: ServerInstance) => {
    if (server.isActive) return
    try {
      await serversApi.activate(server.id)
      // Socket event will refresh the list
    } catch {
      toast({
        title: t('serverListErrors.switchFailedTitle'),
        description: t('serverListErrors.switchFailedDesc', { name: server.name }),
        variant: 'destructive',
      })
    }
  }

  const navSectionVisibleItems = (section: NavSection) =>
    section.items.filter((item) => !item.capability || can(item.capability))

  const itemDisabledReason = (item: NavItem): string | null => {
    if (item.disabled) return t(item.labelKey)
    if (isBlockedByNoServer(item)) return t('nav.requiresServer')
    if (isBlockedByRemote(item)) return t('nav.notAvailableRemote')
    return null
  }

  const renderNavBadges = (item: NavItem) => (
    <>
      {item.badge && (
        <Badge
          variant={isItemActive(item) ? 'secondary' : 'outline'}
          className="ms-auto px-1.5 py-0 text-[10px] uppercase tracking-wider text-warning border-warning/40"
        >
          {item.badge}
        </Badge>
      )}
      {item.to === '/players' && playerCount > 0 && (
        <Badge
          variant={isItemActive(item) ? 'secondary' : 'success'}
          className="ms-auto min-w-[24px] justify-center px-1.5 py-0 text-[10px] leading-tight"
        >
          {playerCountLabel}
        </Badge>
      )}
      {item.to === '/mods' && modUpdatesAvailable > 0 && (
        <Badge
          variant="warning"
          className="ms-auto min-w-[24px] justify-center px-1.5 py-0 text-[10px] leading-tight"
          title={t('modBadge.updatesAvailable', { count: modUpdatesAvailable })}
        >
          {modUpdatesAvailable > 99 ? '99+' : modUpdatesAvailable}
        </Badge>
      )}
      {item.to === '/settings' && panelUpdateAvailable && (
        <span
          className="ms-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warning motion-safe:animate-pulse"
          title={panelUpdateAvailable.version
            ? t('panelUpdateBadge.titleWithVersion', { version: panelUpdateAvailable.version })
            : t('panelUpdateBadge.titleNoVersion')}
          aria-hidden
        />
      )}
    </>
  )

  const sectionHasSignal = (section: NavSection) =>
    (section.id === 'server' && modUpdatesAvailable > 0) ||
    (section.id === 'users' && playerCount > 0) ||
    (section.id === 'panel' && !!panelUpdateAvailable)

  const sectionSignalClass = (section: NavSection) =>
    section.id === 'users' ? 'bg-success' : 'bg-warning motion-safe:animate-pulse'

  const preloadItem = (item: NavItem) => preloadRouteModule(item.to.split('?')[0])

  const renderServerPicker = (variant: 'top' | 'sheet') => {
    if (!servers || servers.length === 0) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'pz-server-picker group relative flex items-center gap-2 rounded-xl border border-border/70 bg-card/70 text-start transition-all duration-200 hover:border-primary/45 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              variant === 'sheet' ? 'w-full px-3 py-2.5' : 'max-w-[230px] px-2.5 py-1.5',
              `pz-server-picker--${serverRunState}`
            )}
          >
            <span className="pz-server-picker__dot relative h-2.5 w-2.5 shrink-0 rounded-full" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[9px] font-semibold uppercase leading-none tracking-[0.18em] text-muted-foreground/70">
                {t('activeServer.label')}
              </span>
              <span className="mt-1 block truncate text-[13px] font-semibold leading-tight text-foreground">
                {activeServer?.name || t('activeServer.none')}
              </span>
            </span>
            {serverRunState === 'running' && playerCount > 0 && (
              <Badge
                variant="success"
                className="shrink-0 px-1.5 py-0 text-[10px] leading-none"
                title={t('activeServer.playersOnline', { count: playerCount })}
              >
                {playerCountLabel}
              </Badge>
            )}
            {activeServer?.isRemote && (
              <Badge
                variant="outline"
                className="shrink-0 px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground/80"
                title={t('activeServer.remoteTitle')}
              >
                {t('activeServer.remoteBadge')}
              </Badge>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            <span className="sr-only">
              {serverRunState === 'running' && t('activeServer.statusRunning')}
              {serverRunState === 'stopped' && t('activeServer.statusStopped')}
              {serverRunState === 'transitioning' && t('activeServer.statusTransitioning')}
              {serverRunState === 'unresponsive' && t('activeServer.statusUnresponsive')}
              {serverRunState === 'unknown' && t('activeServer.statusUnknown')}
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={variant === 'top' ? 'end' : 'start'} className="z-[80] w-64 glass border-border/60">
          {servers.map((server) => (
            <DropdownMenuItem
              key={server.id}
              onSelect={() => { void handleSwitchServer(server) }}
              className={cn(
                'cursor-pointer gap-3 rounded-lg px-3 py-2.5 transition-colors',
                server.isActive && 'bg-primary/10'
              )}
            >
              <span className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
                server.isActive ? 'bg-primary/18 text-primary' : 'bg-muted/70 text-muted-foreground'
              )}>
                <Server className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
              {server.isRemote && (
                <Badge
                  variant="outline"
                  className="px-1.5 py-0 text-[10px] uppercase tracking-wider text-muted-foreground/80"
                  title={t('activeServer.remoteTitle')}
                >
                  {t('activeServer.remoteBadgeFull')}
                </Badge>
              )}
              {server.isActive && (
                <Badge variant="secondary" className="px-2 py-0.5 text-xs uppercase tracking-wide">
                  {t('activeServer.activeBadge')}
                </Badge>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/servers')} className="gap-2.5 rounded-lg px-3 py-2.5">
            <Layers className="h-4 w-4" />
            {t('activeServer.manageServers')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const versionBadge = (className?: string) => panelUpdateAvailable ? (
    <NavLink
      to="/settings?tab=updates"
      onClick={() => setMobileMenuOpen(false)}
      className={cn(
        'inline-flex min-w-0 items-center gap-1 rounded-full border border-warning/60 bg-warning px-1.5 font-mono text-[10px] font-medium text-warning-foreground transition-colors hover:bg-warning/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      title={panelUpdateAvailable.version
        ? t('panelUpdateBadge.titleWithVersionOpenSettings', { version: panelUpdateAvailable.version })
        : t('panelUpdateBadge.titleNoVersionOpenSettings')}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-foreground/70 motion-safe:animate-pulse" />
      <span className="truncate">v{displayVersion}</span>
      <span className="sr-only"> {t('panelUpdateBadge.update')}</span>
    </NavLink>
  ) : (
    <span className={cn('min-w-0 truncate font-mono text-[10px] text-muted-foreground', className)}>
      v{displayVersion}
    </span>
  )

  const topBarTools = (
    <div className="flex items-center gap-1">
      <ConnectionStatus className="h-8 w-8 justify-center p-0" />
      {versionBadge('h-6 max-w-[92px]')}
      <LanguageSwitcher compact className={FOOTER_ICON_BUTTON} />
      <a
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={FOOTER_ICON_BUTTON}
        aria-label={t('footer.githubRepo')}
        title={t('footer.githubRepo')}
      >
        <Github className="h-3.5 w-3.5" />
      </a>
      <button
        type="button"
        onClick={() => setHelpOpen(true)}
        className={FOOTER_ICON_BUTTON}
        aria-label={t('footer.keyboardShortcuts')}
        title={t('footer.keyboardShortcutsTitle')}
      >
        <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/50 text-[10px] font-mono leading-none">?</kbd>
      </button>
      <div className="ms-1 hidden max-w-[150px] border-s border-border/60 ps-2 xl:block">
        <AuthFooter />
      </div>
    </div>
  )

  const bottomPrimaryItems: NavItem[] = [
    dashboardItem,
    navSections[0].items[0],
    navSections[2].items[0],
    navSections[3].items[0],
  ]

  const renderBottomPrimary = (item: NavItem) => {
    const reason = itemDisabledReason(item)
    const active = isItemActive(item)
    const content = (
      <>
        <item.icon className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80')} />
        <span className={cn('text-[10px] font-medium leading-none', active ? 'text-foreground' : 'text-muted-foreground')}>
          {t(item.labelKey)}
        </span>
      </>
    )
    if (reason) {
      return (
        <div
          key={item.to}
          aria-disabled="true"
          title={reason}
          className="pz-bottomnav-item flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center opacity-40"
        >
          {content}
        </div>
      )
    }
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.to === '/'}
        onPointerEnter={() => preloadItem(item)}
        onFocus={() => preloadItem(item)}
        className={cn(
          'pz-bottomnav-item relative flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
          active ? 'bg-primary/12' : 'hover:bg-primary/8'
        )}
      >
        {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden />}
        {content}
      </NavLink>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-screen flex-col bg-background">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm">
          {t('skipToContent')}
        </a>
        <ConnectionAnnouncer />

        {/* Desktop navigation — top command bar with section dropdowns */}
        <header className="pz-topnav fixed inset-x-0 top-0 z-40 hidden lg:block">
          <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
            <div className="flex min-w-0 shrink-0 items-center gap-3">
              <PanelBrand compact />
              {renderServerPicker('top')}
              {serversConfirmedEmpty && (
                <NavLink
                  to="/server-setup"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] font-semibold text-warning transition-colors hover:bg-warning/20"
                >
                  <AlertCircle className="h-3.5 w-3.5" />
                  {t('nav.noServerBanner.cta')}
                </NavLink>
              )}
            </div>

            <nav aria-label={t('nav.ariaLabel')} className="mx-auto flex min-w-0 items-center gap-1">
              <NavLink
                to="/"
                end
                onPointerEnter={() => preloadRouteModule('/')}
                onFocus={() => preloadRouteModule('/')}
                className={cn(
                  'pz-topnav-trigger flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors',
                  location.pathname === '/'
                    ? 'bg-primary/14 text-foreground'
                    : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground'
                )}
              >
                <Gauge className={cn('h-4 w-4', location.pathname === '/' ? 'text-primary' : 'text-muted-foreground/80')} />
                {t(dashboardItem.labelKey)}
              </NavLink>

              {navSections.map((section) => {
                const tone = sectionToneStyles[section.color as keyof typeof sectionToneStyles] || sectionToneStyles.slate
                const visibleItems = navSectionVisibleItems(section)
                const active = section.items.some(isItemActive)
                const signal = sectionHasSignal(section)
                return (
                  <DropdownMenu key={section.id}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          'pz-topnav-trigger group flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                          active
                            ? cn('bg-primary/12 text-foreground', tone.triggerActive)
                            : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground'
                        )}
                      >
                        <section.icon className={cn(
                          'h-4 w-4 shrink-0',
                          active ? tone.labelActive : 'text-muted-foreground/80 group-hover:text-foreground'
                        )} />
                        <span>{t(section.labelKey)}</span>
                        {signal && <span className={cn('h-1.5 w-1.5 rounded-full', sectionSignalClass(section))} aria-hidden />}
                        <ChevronDown className="h-3 w-3 shrink-0 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="pz-topnav-menu z-[80] w-64 border-border/65 bg-popover/95 p-1.5 backdrop-blur-xl">
                      <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
                        {t(section.labelKey)}
                      </div>
                      {visibleItems.map((item) => {
                        const reason = itemDisabledReason(item)
                        const itemActive = isItemActive(item)
                        return (
                          <DropdownMenuItem
                            key={item.to}
                            disabled={!!reason}
                            onPointerEnter={() => preloadItem(item)}
                            onFocus={() => preloadItem(item)}
                            onSelect={() => navigate(item.to)}
                            className={cn(
                              'gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
                              itemActive && 'bg-primary/12 text-foreground'
                            )}
                          >
                            <item.icon className={cn(
                              'h-4 w-4 shrink-0',
                              itemActive ? 'text-primary' : 'text-muted-foreground/80'
                            )} />
                            <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                            {renderNavBadges(item)}
                            {reason && (
                              <span className="ms-auto max-w-[88px] truncate text-[10px] text-muted-foreground">{reason}</span>
                            )}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              })}
            </nav>

            <div className="flex shrink-0 items-center justify-end">{topBarTools}</div>
          </div>
        </header>

        {/* Mobile navigation — bottom command dock with pop-up list */}
        <nav aria-label={t('nav.ariaLabel')} className="pz-bottomnav fixed inset-x-0 bottom-0 z-40 lg:hidden">
          <div className="mx-auto grid h-[68px] max-w-lg grid-cols-5 items-stretch gap-1 px-2 pb-[env(safe-area-inset-bottom)]">
            {bottomPrimaryItems.map(renderBottomPrimary)}
            <button
              ref={mobileMenuButtonRef}
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-expanded={mobileMenuOpen}
              aria-label={t('mobileMenu.open')}
              className={cn(
                'pz-bottomnav-item relative flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                mobileMenuOpen ? 'bg-primary/14' : 'hover:bg-primary/8'
              )}
            >
              {mobileMenuOpen && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" aria-hidden />}
              <Menu className="h-5 w-5 shrink-0 text-muted-foreground/80" />
              <span className="text-[10px] font-medium leading-none text-muted-foreground">{t('mobileMenu.open')}</span>
            </button>
          </div>
        </nav>

        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-[hsl(60_5%_8%/0.68)] backdrop-blur-sm lg:hidden"
              onClick={() => { setMobileMenuOpen(false); mobileMenuButtonRef.current?.focus() }}
              aria-hidden="true"
            />
            <div
              ref={mobileMenuRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('nav.sidebarAriaLabel')}
              className="pz-mobile-sheet fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-border/70 bg-card/95 backdrop-blur-xl lg:hidden"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-card/95 px-4 py-3 backdrop-blur-xl">
                <PanelBrand compact />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setMobileMenuOpen(false); mobileMenuButtonRef.current?.focus() }}
                  aria-label={t('mobileMenu.close')}
                  className="h-10 w-10 rounded-xl border border-transparent hover:border-border/70"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="space-y-3 px-4 py-4">
                {renderServerPicker('sheet')}
                {serversConfirmedEmpty && (
                  <div className="rounded-xl border border-warning/35 bg-warning/[0.06] p-3">
                    <p className="text-[13px] font-semibold text-foreground">{t('nav.noServerBanner.title')}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{t('nav.noServerBanner.description')}</p>
                    <NavLink
                      to="/server-setup"
                      onClick={() => setMobileMenuOpen(false)}
                      className="mt-2 inline-flex items-center text-[11px] font-semibold text-primary hover:underline"
                    >
                      {t('nav.noServerBanner.cta')}
                    </NavLink>
                  </div>
                )}

                <nav aria-label={t('nav.sidebarAriaLabel')}>
                  <NavLink
                    to="/"
                    end
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors',
                      location.pathname === '/' ? 'bg-primary/14 text-foreground' : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground'
                    )}
                  >
                    <Gauge className={cn('h-4 w-4', location.pathname === '/' ? 'text-primary' : 'text-muted-foreground/80')} />
                    {t(dashboardItem.labelKey)}
                  </NavLink>

                  {navSections.map((section) => {
                    const tone = sectionToneStyles[section.color as keyof typeof sectionToneStyles] || sectionToneStyles.slate
                    const visibleItems = navSectionVisibleItems(section)
                    const signal = sectionHasSignal(section)
                    return (
                      <div key={section.id} className="mb-4">
                        <div className="mb-1.5 flex items-center gap-2 px-1">
                          <span className={cn('h-px w-3 rounded-full', tone.childDot)} aria-hidden />
                          <span className={cn('text-[10px] font-semibold uppercase tracking-[0.18em]', tone.labelActive)}>
                            {t(section.labelKey)}
                          </span>
                          {signal && <span className={cn('h-1.5 w-1.5 rounded-full', sectionSignalClass(section))} aria-hidden />}
                          <span className="h-px flex-1 bg-border/40" aria-hidden />
                        </div>
                        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                          {visibleItems.map((item) => {
                            const reason = itemDisabledReason(item)
                            const itemActive = isItemActive(item)
                            const inner = (
                              <>
                                <item.icon className={cn(
                                  'h-4 w-4 shrink-0',
                                  itemActive ? 'text-primary' : 'text-muted-foreground/80'
                                )} />
                                <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                                {!reason && renderNavBadges(item)}
                              </>
                            )
                            if (reason) {
                              return (
                                <DisabledNavTooltip key={item.to} side="top" reason={reason}>
                                  <div
                                    aria-disabled="true"
                                    className="flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] opacity-45"
                                  >
                                    {inner}
                                    <span className="ms-auto max-w-[74px] truncate text-[10px] text-muted-foreground">{reason}</span>
                                  </div>
                                </DisabledNavTooltip>
                              )
                            }
                            return (
                              <NavLink
                                key={item.to}
                                to={item.to}
                                onClick={() => setMobileMenuOpen(false)}
                                className={cn(
                                  'flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                                  itemActive
                                    ? cn('bg-primary/12 font-medium text-foreground', tone.childActive)
                                    : 'text-muted-foreground hover:bg-primary/8 hover:text-foreground'
                                )}
                              >
                                {inner}
                              </NavLink>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </nav>

                <div className="space-y-2.5 border-t border-border/50 pt-3">
                  <ConnectionStatus showLabel className="w-full px-2 py-1" />
                  <AuthFooter />
                  <div className="flex items-center gap-1.5">
                    {versionBadge('h-6 max-w-[92px]')}
                    <span className="ms-auto flex items-center">
                      <LanguageSwitcher compact className={FOOTER_ICON_BUTTON} />
                      <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={FOOTER_ICON_BUTTON}
                        aria-label={t('footer.githubRepo')}
                        title={t('footer.githubRepo')}
                      >
                        <Github className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setHelpOpen(true)}
                        className={FOOTER_ICON_BUTTON}
                        aria-label={t('footer.keyboardShortcuts')}
                        title={t('footer.keyboardShortcutsTitle')}
                      >
                        <kbd className="inline-flex h-4 w-4 items-center justify-center rounded border border-border/50 text-[10px] font-mono leading-none">?</kbd>
                      </button>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Main Content */}
        <main id="main-content" tabIndex={-1} className="pz-main flex-1 overflow-auto pb-24 pt-[76px] focus:outline-none lg:pb-0 lg:pt-20">
          <div className="p-4 lg:p-8 max-w-7xl mx-auto">
            <SystemHealthBanner />
            {/* Server Update Banner — cockpit-style: vertical accent, mono micro-label, tabular build delta */}
            {updateInfo && updateInfo.updateAvailable && !updateDismissed && (
              <div
                role="status"
                className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warning/35 bg-warning/[0.04] py-2 ps-3 pe-2 shadow-[inset_2px_0_0_hsl(var(--warning))]"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-warning">
                    {t('updateBanner.label')}
                  </span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    <Trans
                      t={t}
                      i18nKey="updateBanner.newBuildOn"
                      values={{ branch: updateInfo.installed.branch }}
                      components={{ b: <span className="font-medium text-foreground" /> }}
                    />
                    {updateInfo.latest.description && (
                      <span className="text-muted-foreground/70"> · {updateInfo.latest.description}</span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-foreground/85">
                    b{updateInfo.installed.buildId} <span className="text-muted-foreground/60">→</span> b{updateInfo.latest.buildId}
                  </span>
                </div>
                <div className="ms-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setUpdateDismissed(true)
                      const key = updateInfo && updateInfo.installed && updateInfo.latest
                        ? `updateBannerDismissed:${updateInfo.installed.buildId}->${updateInfo.latest.buildId}`
                        : null
                      if (key) localStorage.setItem(key, 'true')
                    }}
                  >
                    {t('updateBanner.dismiss')}
                  </Button>
                  <Button
                    size="sm"
                    variant="warning"
                    className="h-7 gap-1.5 px-2.5 text-xs font-semibold"
                    onClick={() => navigate('/servers')}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {t('updateBanner.updateServer')}
                  </Button>
                </div>
              </div>
            )}
            {children}
          </div>
        </main>
        <KeyboardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={shortcuts} />
      </div>
    </TooltipProvider>
  )
}
