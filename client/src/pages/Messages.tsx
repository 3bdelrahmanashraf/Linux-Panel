import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Plus,
  RefreshCw,
  Save,
  Send,
  Smartphone,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  smsApi,
  type SmsConfig,
  type SmsEventDef,
  type SmsEvents,
  type SmsRecipient,
} from "@/lib/api";
import { getUserErrorMessage } from "@/lib/errorMessage";
import { useAuth } from "@/contexts/AuthContext";

type Flash = { type: "success" | "error"; text: string } | null;

const EVENT_ORDER = [
  "serverStart",
  "serverStop",
  "playerJoin",
  "playerLeave",
  "scheduledRestart",
  "backupComplete",
  "playerDeath",
  "serverJoinable",
];

// Sample values substituted into an event template when the operator
// previews or sends it on demand. Mirrors the Discord card's samples.
const SAMPLE_VARIABLES: Record<string, Record<string, string | number>> = {
  serverStart: {},
  serverStop: {},
  playerJoin: { player: "JohnDoe" },
  playerLeave: { player: "JohnDoe" },
  playerDeath: {
    player: "JohnDoe",
    location: "Muldraugh, KY",
    x: "10800",
    y: "9200",
    z: "0",
    pvp: "non-pvp",
  },
  scheduledRestart: { minutes: "5" },
  backupComplete: {},
  serverJoinable: {},
};

const DEFAULT_CONFIG: SmsConfig = {
  enabled: false,
  provider: "twilio",
  senderName: "Project Zomboid Server",
  accountSid: "",
  from: "",
  httpUrl: "",
  httpMethod: "POST",
  testMessage: "This is a test message from Project Zomboid Server.",
  secretConfigured: false,
};

function InlineFeedback({
  message,
  className,
}: {
  message: Flash;
  className?: string;
}) {
  const { t } = useTranslation("messages");
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
        {message.type === "error" ? t("shared.errorTitle") : t("shared.successTitle")}
      </AlertTitle>
      <AlertDescription className="whitespace-pre-wrap break-words">
        {message.text}
      </AlertDescription>
    </Alert>
  );
}

export default function Messages() {
  const { t } = useTranslation("messages");
  const { can } = useAuth();
  const canManage = can("integrations.manage");

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Flash>(null);

  const [config, setConfig] = useState<SmsConfig>(DEFAULT_CONFIG);
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configFlash, setConfigFlash] = useState<Flash>(null);

  const [recipients, setRecipients] = useState<SmsRecipient[]>([]);
  const [savingRecipients, setSavingRecipients] = useState(false);
  const [recipientsFlash, setRecipientsFlash] = useState<Flash>(null);

  const [events, setEvents] = useState<SmsEvents>({});
  const [eventDefs, setEventDefs] = useState<Record<string, SmsEventDef>>({});
  const [savingEvents, setSavingEvents] = useState(false);
  const [eventsFlash, setEventsFlash] = useState<Flash>(null);
  const [eventFlash, setEventFlash] = useState<Record<string, Flash>>({});
  const [busyEvent, setBusyEvent] = useState<string | null>(null);

  const [testTarget, setTestTarget] = useState("all");
  const [sendingTest, setSendingTest] = useState(false);
  const [testFlash, setTestFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await smsApi.getConfig();
      setConfig({ ...DEFAULT_CONFIG, ...data.config });
      setRecipients(Array.isArray(data.recipients) ? data.recipients : []);
      setEvents(data.events && typeof data.events === "object" ? data.events : {});
      setEventDefs(
        data.eventDefs && typeof data.eventDefs === "object" ? data.eventDefs : {},
      );
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

  function patchConfig(patch: Partial<SmsConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
  }

  async function saveConfig(messageKey: string) {
    if (!canManage) return;
    setSavingConfig(true);
    setConfigFlash(null);
    try {
      const response = await smsApi.updateConfig(
        config,
        secret.trim() ? secret.trim() : undefined,
        clearSecret,
      );
      setConfig({ ...DEFAULT_CONFIG, ...response.config });
      setSecret("");
      setClearSecret(false);
      setConfigFlash({ type: "success", text: t(messageKey) });
    } catch (error) {
      setConfigFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.save")),
      });
    } finally {
      setSavingConfig(false);
    }
  }

  function addRecipient() {
    setRecipients((current) => [
      ...current,
      {
        id: `new_${Date.now()}_${current.length}`,
        label: "",
        phone: "",
        enabled: true,
      },
    ]);
  }

  function updateRecipient(id: string, patch: Partial<SmsRecipient>) {
    setRecipients((current) =>
      current.map((recipient) =>
        recipient.id === id ? { ...recipient, ...patch } : recipient,
      ),
    );
  }

  function removeRecipient(id: string) {
    const removed = recipients.find((r) => r.id === id);
    setRecipients((current) => current.filter((r) => r.id !== id));
    if (removed && testTarget === removed.phone) setTestTarget("all");
  }

  async function saveRecipients() {
    if (!canManage) return;
    setSavingRecipients(true);
    setRecipientsFlash(null);
    try {
      const response = await smsApi.updateRecipients(recipients);
      setRecipients(response.recipients || []);
      setRecipientsFlash({ type: "success", text: t("recipients.saved") });
    } catch (error) {
      setRecipientsFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.save")),
      });
    } finally {
      setSavingRecipients(false);
    }
  }

  function patchEvent(key: string, patch: { enabled?: boolean; template?: string }) {
    setEvents((current) => ({
      ...current,
      [key]: {
        enabled: current[key]?.enabled ?? false,
        template: current[key]?.template ?? "",
        ...patch,
      },
    }));
  }

  async function saveEvents() {
    if (!canManage) return;
    setSavingEvents(true);
    setEventsFlash(null);
    try {
      const response = await smsApi.updateEvents(events);
      setEvents(response.events || events);
      setEventsFlash({ type: "success", text: t("events.saved") });
    } catch (error) {
      setEventsFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.save")),
      });
    } finally {
      setSavingEvents(false);
    }
  }

  async function sendTestMessage() {
    if (!canManage) return;
    setSendingTest(true);
    setTestFlash(null);
    try {
      const response = await smsApi.test({
        message: config.testMessage,
        to: testTarget === "all" ? undefined : testTarget,
      });
      setTestFlash({
        type: "success",
        text: response.message || t("test.sent"),
      });
    } catch (error) {
      setTestFlash({
        type: "error",
        text: getUserErrorMessage(error, t("errors.test")),
      });
    } finally {
      setSendingTest(false);
    }
  }

  async function testEvent(key: string, dryRun: boolean) {
    if (!canManage) return;
    setBusyEvent(`${key}:${dryRun ? "preview" : "send"}`);
    setEventFlash((current) => ({ ...current, [key]: null }));
    try {
      const response = await smsApi.testEvent({
        eventType: key,
        template: events[key]?.template,
        variables: SAMPLE_VARIABLES[key] ?? {},
        to: testTarget === "all" ? undefined : testTarget,
        dryRun,
      });
      setEventFlash((current) => ({
        ...current,
        [key]: {
          type: "success",
          text: dryRun ? response.rendered : response.message || t("events.sent"),
        },
      }));
    } catch (error) {
      setEventFlash((current) => ({
        ...current,
        [key]: {
          type: "error",
          text: getUserErrorMessage(error, t("errors.test")),
        },
      }));
    } finally {
      setBusyEvent(null);
    }
  }

  const enabledRecipients = recipients.filter((r) => r.enabled);
  const lockReason = canManage ? null : t("errors.noPermission");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
        icon={<Smartphone className="w-5 h-5" />}
        actions={
          <Badge variant={config.enabled ? "default" : "secondary"}>
            {config.enabled ? t("status.enabled") : t("status.disabled")}
          </Badge>
        }
      />

      {loadError && <InlineFeedback message={loadError} />}
      {!canManage && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>{t("errors.noPermissionTitle")}</AlertTitle>
          <AlertDescription>{lockReason}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            {t("page.loading")}
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Provider -------------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                {t("provider.title")}
              </CardTitle>
              <CardDescription>{t("provider.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>{t("provider.enabledLabel")}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t("provider.enabledHint")}
                  </p>
                </div>
                <Switch
                  checked={config.enabled}
                  disabled={!canManage}
                  onCheckedChange={(checked) => patchConfig({ enabled: checked })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t("provider.providerLabel")}</Label>
                  <Select
                    value={config.provider}
                    disabled={!canManage}
                    onValueChange={(value) =>
                      patchConfig({ provider: value as SmsConfig["provider"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="twilio">{t("provider.twilio")}</SelectItem>
                      <SelectItem value="http">{t("provider.http")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t("provider.senderName")}</Label>
                  <Input
                    value={config.senderName}
                    disabled={!canManage}
                    maxLength={60}
                    onChange={(event) =>
                      patchConfig({ senderName: event.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("provider.senderNameHint")}
                  </p>
                </div>
              </div>

              {config.provider === "twilio" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("provider.accountSid")}</Label>
                    <Input
                      value={config.accountSid}
                      disabled={!canManage}
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      onChange={(event) =>
                        patchConfig({ accountSid: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("provider.from")}</Label>
                    <Input
                      value={config.from}
                      disabled={!canManage}
                      placeholder="+1234567890"
                      onChange={(event) => patchConfig({ from: event.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("provider.fromHint")}
                    </p>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>{t("provider.authToken")}</Label>
                    <div className="flex gap-2">
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={secret}
                        disabled={!canManage}
                        placeholder={
                          config.secretConfigured
                            ? t("provider.authTokenStored")
                            : t("provider.authTokenPlaceholder")
                        }
                        onChange={(event) => {
                          setSecret(event.target.value);
                          setClearSecret(false);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setShowSecret((value) => !value)}
                        aria-label={t("provider.authToken")}
                      >
                        {showSecret ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        id="sms-clear-secret"
                        type="checkbox"
                        checked={clearSecret}
                        disabled={!canManage}
                        onChange={(event) => {
                          setClearSecret(event.target.checked);
                          if (event.target.checked) setSecret("");
                        }}
                      />
                      <label htmlFor="sms-clear-secret">
                        {t("provider.clearSecret")}
                      </label>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("provider.httpUrl")}</Label>
                    <Input
                      value={config.httpUrl}
                      disabled={!canManage}
                      placeholder="https://gateway.example.com/send?to={to}&message={message}&sender={sender}&key={key}"
                      onChange={(event) =>
                        patchConfig({ httpUrl: event.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("provider.httpUrlHint")}
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{t("provider.httpMethod")}</Label>
                      <Select
                        value={config.httpMethod}
                        disabled={!canManage}
                        onValueChange={(value) =>
                          patchConfig({ httpMethod: value as "GET" | "POST" })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="GET">GET</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t("provider.authToken")}</Label>
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={secret}
                        disabled={!canManage}
                        placeholder={
                          config.secretConfigured
                            ? t("provider.authTokenStored")
                            : t("provider.apiKeyPlaceholder")
                        }
                        onChange={(event) => {
                          setSecret(event.target.value);
                          setClearSecret(false);
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => saveConfig("provider.saved")}
                  disabled={savingConfig || !canManage}
                >
                  {savingConfig ? (
                    <>
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                      {t("provider.saving")}
                    </>
                  ) : (
                    <>
                      <Save className="me-2 h-4 w-4" />
                      {t("provider.save")}
                    </>
                  )}
                </Button>
              </div>
              <InlineFeedback message={configFlash} />
            </CardContent>
          </Card>

          {/* Test message ---------------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                {t("test.title")}
              </CardTitle>
              <CardDescription>{t("test.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("test.messageLabel")}</Label>
                <Textarea
                  value={config.testMessage}
                  disabled={!canManage}
                  rows={3}
                  maxLength={320}
                  placeholder={t("test.messagePlaceholder")}
                  onChange={(event) =>
                    patchConfig({ testMessage: event.target.value })
                  }
                />
                <p className="text-right text-xs text-muted-foreground">
                  {config.testMessage.length}/320
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("test.sendTo")}</Label>
                <Select
                  value={testTarget}
                  onValueChange={setTestTarget}
                  disabled={enabledRecipients.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("test.allRecipients")}</SelectItem>
                    {enabledRecipients.map((recipient) => (
                      <SelectItem key={recipient.id} value={recipient.phone}>
                        {recipient.label
                          ? `${recipient.label} (${recipient.phone})`
                          : recipient.phone}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => saveConfig("test.savedMessage")}
                  disabled={savingConfig || !canManage}
                >
                  <Save className="me-2 h-4 w-4" />
                  {t("test.saveMessage")}
                </Button>
                <Button
                  onClick={sendTestMessage}
                  disabled={sendingTest || !canManage}
                >
                  {sendingTest ? (
                    <>
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                      {t("test.sending")}
                    </>
                  ) : (
                    <>
                      <Send className="me-2 h-4 w-4" />
                      {t("test.send")}
                    </>
                  )}
                </Button>
              </div>
              <InlineFeedback message={testFlash} />
            </CardContent>
          </Card>

          {/* Recipients ------------------------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                {t("recipients.title")}
              </CardTitle>
              <CardDescription>{t("recipients.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t("recipients.hint")}</span>
              </p>

              {recipients.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  {t("recipients.empty")}
                </p>
              ) : (
                <div className="space-y-3">
                  {recipients.map((recipient, index) => (
                    <div
                      key={recipient.id}
                      className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1.2fr_auto_auto] sm:items-end"
                    >
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {t("recipients.label")}
                        </Label>
                        <Input
                          value={recipient.label}
                          disabled={!canManage}
                          placeholder={t("recipients.labelPlaceholder")}
                          onChange={(event) =>
                            updateRecipient(recipient.id, {
                              label: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {t("recipients.phone")}
                        </Label>
                        <Input
                          value={recipient.phone}
                          disabled={!canManage}
                          inputMode="tel"
                          placeholder={t("recipients.phonePlaceholder")}
                          onChange={(event) =>
                            updateRecipient(recipient.id, {
                              phone: event.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="flex items-center gap-2 pb-2">
                        <Switch
                          checked={recipient.enabled}
                          disabled={!canManage}
                          onCheckedChange={(checked) =>
                            updateRecipient(recipient.id, { enabled: checked })
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {t("recipients.enabled")}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`${t("recipients.remove")} ${index + 1}`}
                        disabled={!canManage}
                        onClick={() => removeRecipient(recipient.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={addRecipient}
                  disabled={!canManage || recipients.length >= 20}
                >
                  <Plus className="me-2 h-4 w-4" />
                  {t("recipients.add")}
                </Button>
                <Button
                  onClick={saveRecipients}
                  disabled={savingRecipients || !canManage}
                >
                  {savingRecipients ? (
                    <>
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                      {t("recipients.saving")}
                    </>
                  ) : (
                    <>
                      <Save className="me-2 h-4 w-4" />
                      {t("recipients.save")}
                    </>
                  )}
                </Button>
              </div>
              <InlineFeedback message={recipientsFlash} />
            </CardContent>
          </Card>

          {/* Event notifications --------------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="h-5 w-5" />
                {t("events.title")}
              </CardTitle>
              <CardDescription>{t("events.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {EVENT_ORDER.map((key) => {
                const def = eventDefs[key] ?? {
                  label: key,
                  description: "",
                  variables: [],
                  defaultTemplate: "",
                };
                const event = events[key] ?? {
                  enabled: false,
                  template: def.defaultTemplate,
                };
                const previewing = busyEvent === `${key}:preview`;
                const sending = busyEvent === `${key}:send`;
                return (
                  <div key={key} className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label className="text-base">{def.label}</Label>
                        <p className="text-xs text-muted-foreground">
                          {def.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("events.variables")}:{" "}
                          <span className="font-mono">
                            {def.variables.length
                              ? def.variables.map((v) => `{${v}}`).join(", ")
                              : t("events.none")}
                          </span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={event.enabled}
                          disabled={!canManage}
                          onCheckedChange={(checked) =>
                            patchEvent(key, { enabled: checked })
                          }
                        />
                        <span className="text-xs text-muted-foreground">
                          {t("events.enabled")}
                        </span>
                      </div>
                    </div>

                    <Textarea
                      value={event.template}
                      disabled={!canManage}
                      rows={2}
                      maxLength={320}
                      placeholder={def.defaultTemplate}
                      onChange={(input) =>
                        patchEvent(key, { template: input.target.value })
                      }
                    />

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyEvent !== null || !canManage}
                        onClick={() => testEvent(key, true)}
                      >
                        {previewing ? (
                          <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="me-1.5 h-3.5 w-3.5" />
                        )}
                        {t("events.preview")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyEvent !== null || !canManage}
                        onClick={() => testEvent(key, false)}
                      >
                        {sending ? (
                          <RefreshCw className="me-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="me-1.5 h-3.5 w-3.5" />
                        )}
                        {t("events.sendTest")}
                      </Button>
                    </div>
                    <InlineFeedback message={eventFlash[key] ?? null} />
                  </div>
                );
              })}

              <div className="flex justify-end">
                <Button
                  onClick={saveEvents}
                  disabled={savingEvents || !canManage}
                >
                  {savingEvents ? (
                    <>
                      <RefreshCw className="me-2 h-4 w-4 animate-spin" />
                      {t("events.saving")}
                    </>
                  ) : (
                    <>
                      <Save className="me-2 h-4 w-4" />
                      {t("events.save")}
                    </>
                  )}
                </Button>
              </div>
              <InlineFeedback message={eventsFlash} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
