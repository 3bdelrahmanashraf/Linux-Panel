import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { modsApi, type ModsExportProgress } from "@/lib/api";
import { getUserErrorMessage } from "@/lib/errorMessage";
import { formatBytes } from "@/lib/formatBytes";
import { copyText } from "@/lib/utils";

type ExportPreview = Awaited<ReturnType<typeof modsApi.getExportPreview>>;

const INITIAL_PROGRESS: ModsExportProgress = {
  active: false,
  phase: "idle",
  percent: 0,
  processedBytes: 0,
  totalBytes: 0,
  error: null,
  cached: null,
  url: null,
  serverName: null,
  startedAt: null,
  updatedAt: null,
};

export default function ExportMods() {
  const { t } = useTranslation("exportMods");
  const { toast } = useToast();
  const { can } = useAuth();
  const canManage = can("mods.manage");

  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [progress, setProgress] = useState<ModsExportProgress>(INITIAL_PROGRESS);
  const [uploading, setUploading] = useState(false);
  // The start POST returns before the long-running ZIP/upload job does. Only
  // begin polling after that 202 arrives, so a stale "done" snapshot from the
  // previous export cannot stop the new one before it is registered.
  const [uploadAccepted, setUploadAccepted] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  // True only while THIS page instance owns the POST. The polling effect may
  // otherwise see the previous (idle/done) snapshot before the POST has
  // registered its progress and stop itself early.
  const localUploadRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await modsApi.getExportPreview();
      if (!mountedRef.current) return;
      setPreview(data);
    } catch (error) {
      if (!mountedRef.current) return;
      setPreview(null);
      setLoadError(
        getUserErrorMessage(error, t("errors.loadFallback")),
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  // If the page was opened (or reloaded) while an upload from another tab or
  // the previous page instance is still running, adopt that server-side
  // progress instead of showing an idle page with a second upload button.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await modsApi.getExportProgress();
        if (cancelled || !result.progress || result.progress.phase === "idle") {
          return;
        }
        if (localUploadRef.current) return;
        setProgress(result.progress);
        if (result.progress.active) {
          setUploading(true);
          setUploadAccepted(true);
        }
      } catch {
        // No progress to adopt; the page can still start a fresh export.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The start request only registers the job; the ZIP + upload takes hours.
  // Poll the process-local progress endpoint so the operator sees
  // measuring -> zipping -> uploading -> verifying with real byte counts.
  useEffect(() => {
    if (!uploading || !uploadAccepted) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const result = await modsApi.getExportProgress();
        if (!cancelled && result.progress) {
          const next = result.progress;
          setProgress(next);
          if (!next.active) {
            const owned = localUploadRef.current;
            localUploadRef.current = false;
            setUploading(false);
            setUploadAccepted(false);
            if (owned && next.phase === "done" && next.url) {
              setPublicUrl(next.url);
              toast({
                title: t("toasts.uploadedTitle"),
                description: next.cached
                  ? t("toasts.uploadedCachedDesc")
                  : t("toasts.uploadedDesc", {
                      size: formatBytes(next.totalBytes || 0),
                    }),
              });
            } else if (owned && next.phase === "error") {
              const message =
                next.error || t("errors.uploadFallback");
              setUploadError(message);
              toast({
                title: t("toasts.uploadFailedTitle"),
                description: message,
                variant: "destructive",
              });
            }
          }
        }
      } catch {
        // A transient poll failure should not hide the upload itself.
      } finally {
        if (!cancelled) timer = setTimeout(tick, 1000);
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [uploading, uploadAccepted, toast, t]);

  const filteredFolders = useMemo(() => {
    const folders = preview?.folders || [];
    const query = search.trim().toLowerCase();
    if (!query) return folders;
    return folders.filter((folder) =>
      folder.name.toLowerCase().includes(query),
    );
  }, [preview, search]);

  const summaryText = useMemo(() => {
    if (!preview) return "";
    return t("summary.line", {
      count: preview.count,
      files: preview.totalFiles,
      size: formatBytes(preview.totalBytes),
    });
  }, [preview, t]);

  const phaseLabel = (phase: ModsExportProgress["phase"]) => {
    switch (phase) {
      case "measuring":
        return t("progress.measuring");
      case "zipping":
        return t("progress.zipping");
      case "uploading":
        return t("progress.uploading");
      case "verifying":
        return t("progress.verifying");
      case "done":
        return t("progress.done");
      case "error":
        return t("progress.failed");
      default:
        return t("progress.waiting");
    }
  };

  const copyValue = async (
    value: string,
    title: string,
    description?: string,
  ) => {
    const ok = await copyText(value);
    toast({
      title: ok ? title : t("toasts.copyFailedTitle"),
      description: ok ? description : t("toasts.copyFailedFallback"),
      variant: ok ? undefined : "destructive",
    });
  };

  const handleDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = modsApi.getExportDownloadUrl();
    anchor.rel = "noopener";
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast({
      title: t("toasts.downloadStartedTitle"),
      description: t("toasts.downloadStartedDesc"),
    });
  };

  const handleUpload = async (force = false) => {
    if (!canManage || uploading) return;
    localUploadRef.current = true;
    setUploading(true);
    setUploadAccepted(false);
    setUploadError(null);
    setPublicUrl(null);
    setProgress({
      ...INITIAL_PROGRESS,
      active: true,
      phase: "measuring",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      // This returns in ~1s with 202 { started, joined }. The ZIP/upload job
      // continues on the server while the polling effect below reports
      // progress, so the browser's normal 15s API timeout is irrelevant.
      await modsApi.startExportUpload({ force });
      if (!mountedRef.current) return;
      setUploadAccepted(true);
    } catch (error) {
      localUploadRef.current = false;
      if (mountedRef.current) {
        const message = getUserErrorMessage(
          error,
          t("errors.uploadFallback"),
        );
        setUploading(false);
        setUploadAccepted(false);
        setUploadError(message);
        setProgress((current) => ({
          ...current,
          active: false,
          phase: "error",
          error: message,
          updatedAt: Date.now(),
        }));
        toast({
          title: t("toasts.uploadFailedTitle"),
          description: message,
          variant: "destructive",
        });
      }
    }
  };

  const percent = Math.max(
    0,
    Math.min(100, Math.round(Number(progress.percent) || 0)),
  );
  const hasProgress =
    uploading || progress.active || progress.phase !== "idle";
  const isDone = progress.phase === "done";
  const isError = progress.phase === "error";
  const displayError = uploadError || (isError ? progress.error : null);
  const copyLink = publicUrl || progress.url;

  return (
    <div className="space-y-6 page-transition">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        eyebrow={t("page.eyebrow")}
        icon={<FileArchive className="h-5 w-5" />}
        tone="config"
        badge={
          preview ? (
            <Badge variant="secondary">
              {t("page.badge", { count: preview.count })}
            </Badge>
          ) : null
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading || uploading}
              className="gap-2"
            >
              <RefreshCw
                className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              {t("actions.refresh")}
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <Link to="/mods">
                <Package className="h-4 w-4" />
                {t("actions.modManager")}
              </Link>
            </Button>
          </>
        }
      />

      {loadError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("errors.loadTitle")}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 break-words">{loadError}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="self-start"
            >
              <RefreshCw className="me-2 h-4 w-4" />
              {t("actions.retry")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!canManage && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("errors.noPermissionTitle")}</AlertTitle>
          <AlertDescription>{t("errors.noPermission")}</AlertDescription>
        </Alert>
      )}

      {loading && !preview ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("page.loading")}
          </CardContent>
        </Card>
      ) : preview ? (
        <>
          <Card>
            <CardContent className="grid gap-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("stats.mods")}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {preview.count}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("stats.files")}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {preview.totalFiles.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("stats.size")}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {formatBytes(preview.totalBytes)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("stats.server")}
                </p>
                <p
                  className="mt-1 truncate text-sm font-medium"
                  title={preview.serverName || undefined}
                >
                  {preview.serverName || t("stats.unknownServer")}
                </p>
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("stats.path")}
                </p>
                <p
                  className="mt-1 break-all font-mono text-[11px] text-muted-foreground"
                  dir="ltr"
                >
                  {preview.modsDir}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {summaryText}
                </p>
              </div>
            </CardContent>
          </Card>

          {hasProgress && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  {isDone ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  ) : isError ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  )}
                  {t("progress.title")}
                </CardTitle>
                <CardDescription>
                  {phaseLabel(progress.phase)}
                  {isDone && progress.cached
                    ? ` · ${t("progress.cached")}`
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress
                  value={percent}
                  aria-label={t("progress.title")}
                  className={isError ? "bg-destructive/20" : undefined}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {t("progress.percent", { percent })}
                  </span>
                  {progress.totalBytes ? (
                    <span className="tabular-nums">
                      {t("progress.bytes", {
                        done: formatBytes(progress.processedBytes || 0),
                        total: formatBytes(progress.totalBytes),
                      })}
                    </span>
                  ) : (
                    <span>{t("progress.bytesUnknown")}</span>
                  )}
                </div>
                {displayError && (
                  <p className="break-words text-sm text-destructive">
                    {displayError}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen className="h-5 w-5" />
                  {t("mods.title")}
                </CardTitle>
                <CardDescription>{t("mods.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t("mods.search")}
                    className="ps-9"
                  />
                </div>
                {filteredFolders.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {preview.folders.length === 0
                      ? t("mods.empty")
                      : t("mods.noMatches")}
                  </p>
                ) : (
                  <div className="max-h-[32rem] overflow-auto rounded-md border border-border/50">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-card">
                        <tr className="border-b border-border/50 text-muted-foreground">
                          <th className="px-3 py-2 font-medium">
                            {t("mods.name")}
                          </th>
                          <th className="px-3 py-2 text-end font-medium">
                            {t("mods.files")}
                          </th>
                          <th className="px-3 py-2 text-end font-medium">
                            {t("mods.size")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFolders.map((folder) => (
                          <tr
                            key={folder.name}
                            className="border-b border-border/30 last:border-0"
                          >
                            <td className="max-w-0 px-3 py-1.5">
                              <span
                                className="block truncate font-mono"
                                title={folder.name}
                              >
                                {folder.name}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-end tabular-nums text-muted-foreground">
                              {folder.files.toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-end tabular-nums text-muted-foreground">
                              {formatBytes(folder.bytes)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {search.trim() && (
                  <p className="text-xs text-muted-foreground">
                    {t("mods.filtered", {
                      shown: filteredFolders.length,
                      total: preview.folders.length,
                    })}
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5" />
                    {t("actions.title")}
                  </CardTitle>
                  <CardDescription>{t("actions.description")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Button
                    className="w-full justify-start gap-2"
                    onClick={() => void handleUpload(false)}
                    disabled={
                      !canManage || uploading || preview.count === 0
                    }
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    {uploading
                      ? t("actions.uploading")
                      : t("actions.upload")}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() => void handleUpload(true)}
                    disabled={
                      !canManage || uploading || preview.count === 0
                    }
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t("actions.reupload")}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={handleDownload}
                    disabled={!canManage || preview.count === 0}
                  >
                    <Download className="h-4 w-4" />
                    {t("actions.download")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="w-full justify-start gap-2"
                    onClick={() =>
                      void copyValue(
                        preview.folders.map((folder) => folder.name).join("\n"),
                        t("toasts.modsCopiedTitle"),
                        t("toasts.modsCopiedDesc"),
                      )
                    }
                    disabled={preview.folders.length === 0}
                  >
                    <Copy className="h-4 w-4" />
                    {t("actions.copyMods")}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="h-5 w-5" />
                    {t("links.title")}
                  </CardTitle>
                  <CardDescription>
                    {copyLink ? t("links.description") : t("links.empty")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {copyLink ? (
                    <div className="space-y-2 rounded-md border border-border/50 bg-muted/30 p-3">
                      <a
                        href={copyLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-primary underline-offset-2 hover:underline"
                        title={copyLink}
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" />
                        <span className="truncate">{copyLink}</span>
                      </a>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1"
                          onClick={() =>
                            void copyValue(
                              copyLink,
                              t("toasts.linkCopiedTitle"),
                              t("toasts.linkCopiedDesc"),
                            )
                          }
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {t("actions.copyLink")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full justify-start gap-2"
                    onClick={() =>
                      void copyValue(
                        modsApi.getExportDownloadUrl(),
                        t("toasts.panelLinkCopiedTitle"),
                        t("toasts.panelLinkCopiedDesc"),
                      )
                    }
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t("actions.copyPanelLink")}
                  </Button>
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    {t("links.footer")}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
