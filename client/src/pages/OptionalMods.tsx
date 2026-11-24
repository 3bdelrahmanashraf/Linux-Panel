import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  ListChecks,
  PackageMinus,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
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
import {
  modsApi,
  type InstalledModEntry,
  type OptionalModsPayload,
} from "@/lib/api";
import { getUserErrorMessage } from "@/lib/errorMessage";
import { useAuth } from "@/contexts/AuthContext";

type Flash = { type: "success" | "error"; text: string } | null;

function InlineFeedback({
  message,
  className,
}: {
  message: Flash;
  className?: string;
}) {
  const { t } = useTranslation("optionalMods");
  if (!message) return null;
  return (
    <Alert
      variant={message.type === "error" ? "destructive" : "default"}
      className={className}
    >
      {message.type === "error" ? (
        <AlertCircle className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      <AlertTitle>
        {message.type === "error"
          ? t("shared.errorTitle")
          : t("shared.successTitle")}
      </AlertTitle>
      <AlertDescription className="whitespace-pre-wrap break-words">
        {message.text}
      </AlertDescription>
    </Alert>
  );
}

function ModBadges({ mod }: { mod: InstalledModEntry }) {
  const { t } = useTranslation("optionalMods");
  return (
    <div className="flex flex-wrap items-center gap-1">
      {mod.missing && <Badge variant="destructive">{t("badges.missing")}</Badge>}
      {!mod.missing && mod.clientOnly && (
        <Badge variant="secondary">{t("badges.clientOnly")}</Badge>
      )}
      {!mod.missing && mod.hasServerContent && (
        <Badge variant="outline">{t("badges.serverContent")}</Badge>
      )}
      {!mod.missing && mod.hasSharedContent && (
        <Badge variant="outline">{t("badges.shared")}</Badge>
      )}
      {!mod.missing && mod.noContent && (
        <Badge variant="secondary">{t("badges.noContent")}</Badge>
      )}
    </div>
  );
}

function ModIdentity({ mod }: { mod: InstalledModEntry }) {
  const { t } = useTranslation("optionalMods");
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate font-medium">{mod.name}</span>
        <ModBadges mod={mod} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span className="font-mono">{mod.id}</span>
        {mod.folder && (
          <span title={mod.folder} className="max-w-[18rem] truncate">
            {mod.folder}
          </span>
        )}
        {mod.requires && mod.requires.length > 0 && (
          <span title={mod.requires.join(", ")}>
            {t("badges.requires", { count: mod.requires.length })}
          </span>
        )}
      </div>
    </div>
  );
}

function matchesQuery(mod: InstalledModEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    mod.id.toLowerCase().includes(q) ||
    mod.name.toLowerCase().includes(q) ||
    (mod.folder || "").toLowerCase().includes(q)
  );
}

export default function OptionalMods() {
  const { t } = useTranslation("optionalMods");
  const { can } = useAuth();
  const canManage = can("mods.manage");

  const [data, setData] = useState<OptionalModsPayload | null>(null);
  const [optionalIds, setOptionalIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Flash>(null);
  const [flash, setFlash] = useState<Flash>(null);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [optionalSearch, setOptionalSearch] = useState("");
  const [availableSearch, setAvailableSearch] = useState("");
  const [requiredSearch, setRequiredSearch] = useState("");
  const [restartNeeded, setRestartNeeded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const payload = await modsApi.getOptionalMods();
      setData(payload);
      setOptionalIds(payload.optional.map((mod) => mod.id));
    } catch (error) {
      setLoadError({
        type: "error",
        text: getUserErrorMessage(error, t("errors.load")),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const savedOptionalIds = useMemo(
    () => new Set((data?.optional || []).map((mod) => mod.id)),
    [data],
  );
  const optionalSet = useMemo(() => new Set(optionalIds), [optionalIds]);
  const requiredIds = useMemo(
    () => (data?.required || []).map((mod) => mod.id),
    [data],
  );
  const requiredSet = useMemo(() => new Set(requiredIds), [requiredIds]);

  const allById = useMemo(() => {
    const map = new Map<string, InstalledModEntry>();
    for (const mod of [
      ...(data?.required || []),
      ...(data?.optional || []),
      ...(data?.available || []),
    ]) {
      if (!map.has(mod.id)) map.set(mod.id, mod);
    }
    return map;
  }, [data]);

  const optionalEntries = useMemo(
    () =>
      optionalIds.map(
        (id) =>
          allById.get(id) || {
            id,
            name: id,
            missing: true,
          },
      ),
    [optionalIds, allById],
  );

  const filteredOptional = useMemo(
    () => optionalEntries.filter((mod) => matchesQuery(mod, optionalSearch)),
    [optionalEntries, optionalSearch],
  );

  // The API's `available` is a snapshot taken at load time. Rebuild it from
  // every installed entry so removing a mod from the optional list moves it
  // back into "add a mod" without a reload.
  const allInstalled = useMemo(() => {
    const map = new Map<string, InstalledModEntry>();
    for (const mod of [
      ...(data?.available || []),
      ...(data?.required || []).filter((entry) => !entry.missing),
      ...(data?.optional || []).filter((entry) => !entry.missing),
    ]) {
      if (!map.has(mod.id)) map.set(mod.id, mod);
    }
    return [...map.values()];
  }, [data]);

  const availableEntries = useMemo(
    () =>
      allInstalled.filter(
        (mod) => !requiredSet.has(mod.id) && !optionalSet.has(mod.id),
      ),
    [allInstalled, requiredSet, optionalSet],
  );
  const filteredAvailable = useMemo(
    () =>
      availableEntries
        .filter((mod) => matchesQuery(mod, availableSearch))
        .slice(0, 200),
    [availableEntries, availableSearch],
  );

  const filteredRequired = useMemo(
    () =>
      (data?.required || [])
        .filter((mod) => matchesQuery(mod, requiredSearch))
        .slice(0, 400),
    [data, requiredSearch],
  );

  const dirty = useMemo(() => {
    if (optionalIds.length !== savedOptionalIds.size) return true;
    return optionalIds.some((id) => !savedOptionalIds.has(id));
  }, [optionalIds, savedOptionalIds]);

  const addOptional = useCallback(
    (id: string) => {
      setFlash(null);
      setOptionalIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setRestartNeeded(false);
    },
    [],
  );

  const removeOptional = useCallback((id: string) => {
    setFlash(null);
    setOptionalIds((current) => current.filter((value) => value !== id));
    setRestartNeeded(false);
  }, []);

  const saveList = useCallback(async () => {
    setSaving(true);
    setFlash(null);
    try {
      const result = await modsApi.saveOptionalMods(optionalIds);
      setOptionalIds(result.optional);
      await load();
      setFlash({
        type: "success",
        text:
          result.rejected.length > 0
            ? t("optional.savedRejected", { count: result.rejected.length })
            : t("optional.saved"),
      });
    } catch (error) {
      setFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.save")),
      });
    } finally {
      setSaving(false);
    }
  }, [optionalIds, load, t]);

  const applyList = useCallback(async () => {
    setApplying(true);
    setFlash(null);
    try {
      const result = await modsApi.applyOptionalMods(optionalIds);
      setRestartNeeded(true);
      await load();
      const suffix = result.backupWarning ? `\n${result.backupWarning}` : "";
      setFlash({
        type: "success",
        text:
          result.removed.length > 0
            ? t("optional.applied", {
                count: result.removed.length,
                required: result.requiredCount,
              }) + suffix
            : t("optional.nothingRemoved") + suffix,
      });
    } catch (error) {
      setFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.apply")),
      });
    } finally {
      setApplying(false);
    }
  }, [optionalIds, load, t]);

  const stats = data?.stats;
  const modsFolderFound = data?.server.modsFolderFound !== false;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        icon={<PackageMinus className="h-5 w-5" />}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {stats && (
              <Badge variant="secondary">
                {t("page.badge", {
                  required: stats.required,
                  optional: stats.optional,
                })}
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw
                className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              {t("page.refresh")}
            </Button>
          </div>
        }
      />

      {loadError && <InlineFeedback message={loadError} />}
      {!canManage && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("errors.noPermissionTitle")}</AlertTitle>
          <AlertDescription>{t("errors.noPermission")}</AlertDescription>
        </Alert>
      )}
      {data && !modsFolderFound && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{t("errors.noModsFolderTitle")}</AlertTitle>
          <AlertDescription>{t("errors.noModsFolder")}</AlertDescription>
        </Alert>
      )}
      {data && stats && stats.missingOptional > 0 && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("errors.missingOptionalTitle")}</AlertTitle>
          <AlertDescription>
            {t("errors.missingOptional", { count: stats.missingOptional })}
          </AlertDescription>
        </Alert>
      )}

      {loading && !data ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t("page.loading")}
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["required", stats?.required ?? 0],
              ["optional", stats?.optional ?? 0],
              ["installed", stats?.installed ?? 0],
              ["available", stats?.available ?? 0],
            ].map(([key, value]) => (
              <Card key={String(key)}>
                <CardContent className="py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t(`stats.${key}`)}
                  </p>
                  <p className="mt-1 text-2xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>{t("how.title")}</AlertTitle>
            <AlertDescription>{t("how.body")}</AlertDescription>
          </Alert>

          {restartNeeded && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{t("restart.title")}</AlertTitle>
              <AlertDescription>{t("restart.body")}</AlertDescription>
            </Alert>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ListChecks className="h-5 w-5" />
                  {t("optional.title")}
                </CardTitle>
                <CardDescription>{t("optional.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void saveList()}
                    disabled={!canManage || saving || !dirty}
                  >
                    <Save className="me-2 h-4 w-4" />
                    {saving ? t("optional.saving") : t("optional.save")}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => void applyList()}
                    disabled={!canManage || applying || optionalIds.length === 0}
                  >
                    {applying ? (
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                    ) : (
                      <PackageMinus className="me-2 h-4 w-4" />
                    )}
                    {applying ? t("optional.applying") : t("optional.apply")}
                  </Button>
                </div>

                {dirty && (
                  <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    {t("optional.dirty")}
                  </p>
                )}

                <Input
                  value={optionalSearch}
                  onChange={(event) => setOptionalSearch(event.target.value)}
                  placeholder={t("optional.search")}
                />

                {filteredOptional.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    {optionalIds.length === 0
                      ? t("optional.empty")
                      : t("optional.noMatches")}
                  </p>
                ) : (
                  <div className="max-h-[34rem] space-y-2 overflow-y-auto pe-1">
                    {filteredOptional.map((mod) => {
                      const isRequired = requiredSet.has(mod.id);
                      return (
                        <div
                          key={mod.id}
                          className="flex items-start justify-between gap-3 rounded-lg border p-3"
                        >
                          <div className="min-w-0 space-y-1">
                            <ModIdentity mod={mod} />
                            {isRequired && (
                              <Badge variant="destructive">
                                {t("optional.currentlyRequired")}
                              </Badge>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeOptional(mod.id)}
                            disabled={!canManage}
                            aria-label={t("optional.remove")}
                            title={t("optional.remove")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  {t("available.title")}
                </CardTitle>
                <CardDescription>{t("available.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={availableSearch}
                  onChange={(event) => setAvailableSearch(event.target.value)}
                  placeholder={t("available.search")}
                />
                {filteredAvailable.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">
                    {availableSearch
                      ? t("available.noMatches")
                      : t("available.empty")}
                  </p>
                ) : (
                  <div className="max-h-[34rem] space-y-2 overflow-y-auto pe-1">
                    {filteredAvailable.map((mod) => (
                      <div
                        key={mod.id}
                        className="flex items-start justify-between gap-3 rounded-lg border p-3"
                      >
                        <ModIdentity mod={mod} />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => addOptional(mod.id)}
                          disabled={!canManage}
                        >
                          <Plus className="me-1 h-3.5 w-3.5" />
                          {t("available.add")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                {t("required.title", { count: stats?.required ?? 0 })}
              </CardTitle>
              <CardDescription>{t("required.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={requiredSearch}
                onChange={(event) => setRequiredSearch(event.target.value)}
                placeholder={t("required.search")}
              />
              {filteredRequired.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {requiredSearch
                    ? t("required.noMatches")
                    : t("required.empty")}
                </p>
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
                  {filteredRequired.map((mod) => (
                    <div
                      key={mod.id}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3"
                    >
                      <ModIdentity mod={mod} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => addOptional(mod.id)}
                        disabled={!canManage || optionalSet.has(mod.id)}
                      >
                        <PackageMinus className="me-1 h-3.5 w-3.5" />
                        {t("required.makeOptional")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {!requiredSearch && (stats?.required ?? 0) > 400 && (
                <p className="text-xs text-muted-foreground">
                  {t("required.truncated", {
                    shown: filteredRequired.length,
                    total: stats?.required ?? 0,
                  })}
                </p>
              )}
            </CardContent>
          </Card>

          <InlineFeedback message={flash} />
        </>
      ) : null}
    </div>
  );
}
