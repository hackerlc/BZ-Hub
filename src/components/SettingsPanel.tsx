import { useEffect, useState } from "react";
import {
  Bot,
  Check,
  CircleAlert,
  CircleCheck,
  Cloud,
  CloudOff,
  CloudSun,
  Download,
  Eye,
  EyeOff,
  FolderCog,
  KeyRound,
  Laptop,
  LoaderCircle,
  LogOut,
  Monitor,
  FolderOpen,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createId } from "../lib/id";
import { wallpaperWeatherOptions } from "../lib/wallpaper";
import type { Category, DevicePreferences, SharedPreferences } from "../types";
import type { ImportMode } from "../lib/dataTransfer";

type SettingsTab = "general" | "categories" | "data" | "sync";

interface SettingsPanelProps {
  categories: Category[];
  sharedPreferences: SharedPreferences;
  devicePreferences: DevicePreferences;
  cloudConfigured: boolean;
  accountEmail?: string;
  syncing: boolean;
  aiControlBusy: boolean;
  taskbarTransparencyAvailable: boolean;
  taskbarTransparencyBusy: boolean;
  wallpaperBusy: boolean;
  wallpaperBridgeInfo?: { available: boolean; url?: string; port?: number } | null;
  lastSyncedAt?: string;
  syncError?: string;
  onClose: () => void;
  onSharedPreferencesChange: (patch: Partial<Omit<SharedPreferences, "updatedAt">>) => void;
  onDevicePreferencesChange: (patch: Partial<DevicePreferences>) => void;
  onAutostartChange: (enabled: boolean) => Promise<void>;
  onAiControlChange: (enabled: boolean) => Promise<void>;
  onTaskbarTransparencyChange: (enabled: boolean) => Promise<void>;
  onWallpaperDetect: () => Promise<string | null>;
  onWallpaperPickEngine: () => Promise<void>;
  onWallpaperPickProject: () => Promise<void>;
  onWallpaperConfigure: () => Promise<void>;
  onWallpaperOpen: () => Promise<void>;
  onCategorySave: (category: Category) => void;
  onCategoryDelete: (categoryId: string) => void;
  onExportData: () => Promise<string | null>;
  onImportData: (mode: ImportMode) => Promise<string | null>;
  onSendOtp: (email: string) => Promise<void>;
  onVerifyEmailLogin: (email: string, credential: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSync: () => Promise<void>;
}

const categoryColors = ["#7c8cff", "#4cc9a4", "#ffad66", "#ff7e8b", "#aa83ff", "#49b8d8"];

function formatSyncTime(value?: string): string {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [tab, setTab] = useState<SettingsTab>("general");
  const [city, setCity] = useState(props.sharedPreferences.weatherCity);
  const [weatherHost, setWeatherHost] = useState(props.devicePreferences.qweatherApiHost);
  const [weatherKey, setWeatherKey] = useState(props.devicePreferences.qweatherApiKey);
  const [showWeatherKey, setShowWeatherKey] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [dataBusy, setDataBusy] = useState(false);
  const [dataMessage, setDataMessage] = useState("");
  const [dataMessageType, setDataMessageType] = useState<"success" | "error">("success");
  const [wallpaperMessage, setWallpaperMessage] = useState("");
  const [wallpaperMessageType, setWallpaperMessageType] = useState<"success" | "error">("success");

  const activeCategories = props.categories.filter((category) => !category.deletedAt);

  useEffect(() => setCity(props.sharedPreferences.weatherCity), [props.sharedPreferences.weatherCity]);
  useEffect(() => setWeatherHost(props.devicePreferences.qweatherApiHost), [props.devicePreferences.qweatherApiHost]);
  useEffect(() => setWeatherKey(props.devicePreferences.qweatherApiKey), [props.devicePreferences.qweatherApiKey]);

  const addCategory = () => {
    const name = newCategory.trim();
    if (!name) return;
    const now = new Date().toISOString();
    props.onCategorySave({
      id: createId(),
      name,
      color: categoryColors[activeCategories.length % categoryColors.length],
      sortOrder: activeCategories.length,
      createdAt: now,
      updatedAt: now,
    });
    setNewCategory("");
  };

  const handleSendOtp = async () => {
    if (!email.trim()) return setAuthMessage("请输入邮箱地址");
    setAuthBusy(true);
    setAuthMessage("");
    try {
      await props.onSendOtp(email.trim());
      setOtpSent(true);
      setAuthMessage("登录邮件已发送。若邮件只有 Sign in，请右键复制其链接地址，不要先点击");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "验证码发送失败");
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVerifyEmailLogin = async () => {
    if (!credential.trim()) return setAuthMessage("请输入六位验证码，或粘贴邮件中的 Sign in 原始链接");
    setAuthBusy(true);
    setAuthMessage("");
    try {
      await props.onVerifyEmailLogin(email.trim(), credential.trim());
      setAuthMessage("登录成功，正在同步数据");
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : "登录验证失败");
    } finally {
      setAuthBusy(false);
    }
  };

  const runDataAction = async (action: () => Promise<string | null>) => {
    setDataBusy(true);
    setDataMessage("");
    try {
      const message = await action();
      if (message) {
        setDataMessageType("success");
        setDataMessage(message);
      }
    } catch (error) {
      setDataMessageType("error");
      setDataMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDataBusy(false);
    }
  };

  const runWallpaperAction = async (action: () => Promise<void>) => {
    setWallpaperMessage("");
    try {
      await action();
      setWallpaperMessageType("success");
    } catch (error) {
      setWallpaperMessageType("error");
      setWallpaperMessage(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="modal settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal__header">
          <div>
            <span className="eyebrow">PREFERENCES</span>
            <h2 id="settings-title">设置</h2>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>

        <nav className="settings-tabs" aria-label="设置分类">
          <button type="button" className={tab === "general" ? "is-active" : ""} onClick={() => setTab("general")}>
            <Settings2 size={16} /> 通用
          </button>
          <button type="button" className={tab === "categories" ? "is-active" : ""} onClick={() => setTab("categories")}>
            <FolderCog size={16} /> 分类
          </button>
          <button type="button" className={tab === "data" ? "is-active" : ""} onClick={() => setTab("data")}>
            <Download size={16} /> 数据
          </button>
          <button type="button" className={tab === "sync" ? "is-active" : ""} onClick={() => setTab("sync")}>
            <Cloud size={16} /> 同步
          </button>
        </nav>

        <div className="settings-content">
          {tab === "general" && (
            <div className="settings-section">
              <div className="settings-section__intro">
                <Laptop size={20} />
                <div>
                  <h3>这台设备</h3>
                  <p>这些选项只保存在当前电脑，不会同步到其他设备。</p>
                </div>
              </div>

              <label className="setting-row">
                <span>
                  <strong>开机时启动</strong>
                  <small>静默驻留在托盘或菜单栏</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={props.devicePreferences.launchAtLogin}
                  className={`switch ${props.devicePreferences.launchAtLogin ? "is-on" : ""}`}
                  disabled={autostartBusy}
                  onClick={async () => {
                    setAutostartBusy(true);
                    try {
                      await props.onAutostartChange(!props.devicePreferences.launchAtLogin);
                    } finally {
                      setAutostartBusy(false);
                    }
                  }}
                >
                  <i />
                </button>
              </label>

              <label className="setting-row setting-row--field">
                <span>
                  <strong>全局快捷键</strong>
                  <small>在任何应用中快速显示或隐藏面板</small>
                </span>
                <input
                  value={props.devicePreferences.shortcut}
                  readOnly
                  title="第一版固定快捷键，后续将加入快捷键录制"
                  spellCheck={false}
                />
              </label>

              <label className="setting-row">
                <span>
                  <strong>失去焦点后隐藏</strong>
                  <small>点击其他应用时自动收起面板</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={props.devicePreferences.hideOnBlur}
                  className={`switch ${props.devicePreferences.hideOnBlur ? "is-on" : ""}`}
                  onClick={() => props.onDevicePreferencesChange({ hideOnBlur: !props.devicePreferences.hideOnBlur })}
                >
                  <i />
                </button>
              </label>

              <label className="setting-row">
                <span>
                  <strong>打开入口后收起</strong>
                  <small>启动网页或应用后自动收起到托盘</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={props.devicePreferences.hideAfterLaunch}
                  className={`switch ${props.devicePreferences.hideAfterLaunch ? "is-on" : ""}`}
                  onClick={() => props.onDevicePreferencesChange({ hideAfterLaunch: !props.devicePreferences.hideAfterLaunch })}
                >
                  <i />
                </button>
              </label>

              {props.taskbarTransparencyAvailable && (
                <label className="setting-row">
                  <span>
                    <strong>任务栏完全透明</strong>
                    <small>{props.devicePreferences.taskbarTransparent
                      ? "当前为完全透明；关闭后恢复 Windows 系统默认"
                      : "当前使用 Windows 系统默认外观"}</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-label="任务栏完全透明"
                    aria-checked={props.devicePreferences.taskbarTransparent}
                    className={`switch ${props.devicePreferences.taskbarTransparent ? "is-on" : ""}`}
                    disabled={props.taskbarTransparencyBusy}
                    onClick={() => void props.onTaskbarTransparencyChange(!props.devicePreferences.taskbarTransparent)}
                  >
                    <i />
                  </button>
                </label>
              )}

              <div className="settings-divider" />

              <div className="settings-section__intro settings-section__intro--compact">
                <Monitor size={20} />
                <div>
                  <h3>动态桌面</h3>
                  <p>用 Wallpaper Engine 显示随时间变化的山谷风景，并接收 BZ Hub 当前天气。程序和项目路径只保存在这台电脑。</p>
                </div>
              </div>

              <label className="setting-row">
                <span>
                  <strong>启用天气联动</strong>
                  <small>天气会通过本机只读桥接更新，不会暴露和风天气密钥</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={props.devicePreferences.wallpaperEnabled}
                  className={`switch ${props.devicePreferences.wallpaperEnabled ? "is-on" : ""}`}
                  onClick={() => props.onDevicePreferencesChange({ wallpaperEnabled: !props.devicePreferences.wallpaperEnabled })}
                >
                  <i />
                </button>
              </label>

              <div className="wallpaper-settings">
                <label className="setting-row">
                  <span>
                    <strong>模拟桌面天气与时间</strong>
                    <small>只影响壁纸；主页天气、系统时间和日历保持真实数据</small>
                  </span>
                  <button type="button" role="switch" aria-label="模拟桌面天气与时间"
                    aria-checked={props.devicePreferences.wallpaperSimulationEnabled}
                    className={`switch ${props.devicePreferences.wallpaperSimulationEnabled ? "is-on" : ""}`}
                    onClick={() => props.onDevicePreferencesChange({
                      wallpaperSimulationEnabled: !props.devicePreferences.wallpaperSimulationEnabled,
                    })}>
                    <i />
                  </button>
                </label>
                {props.devicePreferences.wallpaperSimulationEnabled && (
                  <div className="wallpaper-simulation">
                    <div className="wallpaper-simulation__fields">
                      <label className="field">
                        <span>模拟时间（固定在此时刻）</span>
                        <input type="time" required value={props.devicePreferences.wallpaperSimulationTime}
                          onChange={(event) => {
                            if (event.target.validity.valid && event.target.value) {
                              props.onDevicePreferencesChange({ wallpaperSimulationTime: event.target.value });
                            }
                          }} />
                      </label>
                      <label className="field">
                        <span>模拟天气</span>
                        <select aria-label="模拟天气" value={props.devicePreferences.wallpaperSimulationWeather}
                          onChange={(event) => props.onDevicePreferencesChange({ wallpaperSimulationWeather: event.target.value })}>
                          {wallpaperWeatherOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <p className="wallpaper-settings__note" role="status">
                      {props.devicePreferences.wallpaperEnabled
                        ? "模拟已开启，壁纸约 2 秒内直接切换场景；关闭模拟即恢复真实时间与天气。无需天气 API 即可测试。"
                        : "模拟参数已保存。请打开上方“启用天气联动”以发送到壁纸。"}
                    </p>
                  </div>
                )}
                <label className="field">
                  <span>Wallpaper Engine 程序</span>
                  <input
                    value={props.devicePreferences.wallpaperEnginePath}
                    onChange={(event) => props.onDevicePreferencesChange({ wallpaperEnginePath: event.target.value })}
                    placeholder="选择 launcher.exe 或 wallpaper64.exe"
                    spellCheck={false}
                  />
                </label>
                <div className="wallpaper-settings__actions">
                  <button type="button" className="button button--ghost" onClick={() => void runWallpaperAction(async () => { await props.onWallpaperDetect(); })} disabled={props.wallpaperBusy}>
                    <PlugZap size={14} /> 自动查找
                  </button>
                  <button type="button" className="button button--ghost" onClick={() => void runWallpaperAction(props.onWallpaperPickEngine)} disabled={props.wallpaperBusy}>
                    <FolderOpen size={14} /> 选择程序
                  </button>
                </div>

                <label className="field">
                  <span>Wallpaper Engine 项目文件夹</span>
                  <input
                    value={props.devicePreferences.wallpaperProjectPath}
                    onChange={(event) => props.onDevicePreferencesChange({ wallpaperProjectPath: event.target.value })}
                    placeholder="选择包含 index.html 的项目文件夹"
                    spellCheck={false}
                  />
                </label>
                <div className="wallpaper-settings__actions">
                  <button type="button" className="button button--ghost" onClick={() => void runWallpaperAction(props.onWallpaperPickProject)} disabled={props.wallpaperBusy}>
                    <FolderOpen size={14} /> 选择项目
                  </button>
                  <button type="button" className="button button--secondary" onClick={() => void runWallpaperAction(props.onWallpaperConfigure)} disabled={props.wallpaperBusy || !props.devicePreferences.wallpaperProjectPath}>
                    <CloudSun size={14} /> 连接天气
                  </button>
                  <button type="button" className="button button--primary" onClick={() => void runWallpaperAction(props.onWallpaperOpen)} disabled={props.wallpaperBusy || !props.devicePreferences.wallpaperEnginePath || !props.devicePreferences.wallpaperProjectPath}>
                    {props.wallpaperBusy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} 连接并打开
                  </button>
                </div>
                <p className="wallpaper-settings__note">
                  {props.wallpaperBridgeInfo?.available
                    ? `本机天气桥接已运行（端口 ${props.wallpaperBridgeInfo.port ?? "—"}）。`
                    : "天气桥接尚未就绪；重启 BZ Hub 后会自动启动。"}
                  Wallpaper Engine 首次导入后会复制项目，请选择复制后的目录。
                </p>
                {wallpaperMessage && (
                  <p className={`wallpaper-settings__message ${wallpaperMessageType === "error" ? "is-error" : ""}`}>
                    {wallpaperMessage}
                  </p>
                )}
              </div>

              <div className="settings-divider" />

              <div className="settings-section__intro settings-section__intro--compact">
                <Bot size={20} />
                <div>
                  <h3>AI 控制</h3>
                  <p>允许本机 AI 助手查找并打开现有入口，以及管理 BZ Hub 日历事项。</p>
                </div>
              </div>

              <label className="setting-row">
                <span>
                  <strong>允许 AI 操控 BZ Hub</strong>
                  <small>使用本机随机令牌授权；不允许执行任意命令或打开未配置路径</small>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={props.devicePreferences.aiControlEnabled}
                  className={`switch ${props.devicePreferences.aiControlEnabled ? "is-on" : ""}`}
                  disabled={props.aiControlBusy}
                  onClick={() => void props.onAiControlChange(!props.devicePreferences.aiControlEnabled)}
                >
                  <i />
                </button>
              </label>

              <div className="settings-divider" />

              <div className="settings-section__intro settings-section__intro--compact">
                <CloudSun size={20} />
                <div>
                  <h3>和风天气</h3>
                  <p>仅使用 GeoAPI 与实时天气。凭据只保存在这台电脑，不参与云同步。</p>
                </div>
              </div>

              <div className="setting-stack weather-settings">
                <label className="field">
                  <span>天气城市</span>
                  <input value={city} onChange={(event) => setCity(event.target.value)} placeholder="例如：上海" />
                </label>
                <label className="field">
                  <span>专属 API Host <small>控制台 → 设置</small></span>
                  <input
                    value={weatherHost}
                    onChange={(event) => setWeatherHost(event.target.value)}
                    placeholder="abc123xyz.def.qweatherapi.com"
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>API Key <small>控制台 → 项目凭据</small></span>
                  <span className="secret-field">
                    <input
                      type={showWeatherKey ? "text" : "password"}
                      value={weatherKey}
                      onChange={(event) => setWeatherKey(event.target.value)}
                      placeholder="输入 X-QW-Api-Key"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <button type="button" onClick={() => setShowWeatherKey((visible) => !visible)} aria-label={showWeatherKey ? "隐藏 API Key" : "显示 API Key"}>
                      {showWeatherKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                </label>
                <p className="weather-settings__note">天气缓存 20 分钟。按当前价格，天气与基础服务合计每月前 50,000 次请求为免费额度。</p>
                <button
                  type="button"
                  className="button button--secondary"
                  onClick={() => {
                    props.onSharedPreferencesChange({ weatherCity: city.trim() });
                    props.onDevicePreferencesChange({
                      qweatherApiHost: weatherHost.trim(),
                      qweatherApiKey: weatherKey.trim(),
                    });
                  }}
                  disabled={
                    !city.trim()
                    || !weatherHost.trim()
                    || !weatherKey.trim()
                    || (
                      city.trim() === props.sharedPreferences.weatherCity
                      && weatherHost.trim() === props.devicePreferences.qweatherApiHost
                      && weatherKey.trim() === props.devicePreferences.qweatherApiKey
                    )
                  }
                >
                  保存天气设置
                </button>
              </div>
            </div>
          )}

          {tab === "categories" && (
            <div className="settings-section">
              <div className="settings-section__intro">
                <FolderCog size={20} />
                <div>
                  <h3>入口分类</h3>
                  <p>分类名称和顺序会同步，删除分类时其中入口会移至其他分类。</p>
                </div>
              </div>

              <div className="category-list">
                {activeCategories.map((category) => (
                  <div className="category-row" key={category.id}>
                    <span className="category-row__color" style={{ background: category.color }} />
                    <input
                      value={category.name}
                      onChange={(event) => props.onCategorySave({
                        ...category,
                        name: event.target.value,
                        updatedAt: new Date().toISOString(),
                      })}
                    />
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      disabled={activeCategories.length <= 1}
                      onClick={() => props.onCategoryDelete(category.id)}
                      aria-label={`删除分类 ${category.name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="add-category">
                <input
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addCategory()}
                  placeholder="新分类名称"
                />
                <button type="button" className="button button--secondary" onClick={addCategory}>
                  <Plus size={15} /> 添加
                </button>
              </div>
            </div>
          )}

          {tab === "data" && (
            <div className="settings-section">
              <div className="settings-section__intro">
                <Download size={20} />
                <div>
                  <h3>导出与导入</h3>
                  <p>导出文件包含分类、入口、别名、组合目标和启动记录，不包含天气密钥、登录令牌及窗口位置。</p>
                </div>
              </div>

              <div className="data-actions">
                <article className="data-action-card">
                  <span><Download size={19} /></span>
                  <div>
                    <strong>版本化 JSON 备份</strong>
                    <small>保存为可迁移到其他设备的 BZ Hub 数据文件。</small>
                  </div>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={dataBusy}
                    onClick={() => void runDataAction(props.onExportData)}
                  >
                    导出
                  </button>
                </article>

                <article className="data-action-card">
                  <span><Upload size={19} /></span>
                  <div>
                    <strong>合并导入</strong>
                    <small>按更新时间合并同名 ID，保留当前设备中较新的内容。</small>
                  </div>
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={dataBusy}
                    onClick={() => void runDataAction(() => props.onImportData("merge"))}
                  >
                    合并
                  </button>
                </article>

                <article className="data-action-card data-action-card--danger">
                  <span><Upload size={19} /></span>
                  <div>
                    <strong>全部替换</strong>
                    <small>保留本机设置，但用导入文件替换现有入口、分类和记录。</small>
                  </div>
                  <button
                    type="button"
                    className="button button--danger-ghost"
                    disabled={dataBusy}
                    onClick={() => {
                      if (!window.confirm("确定用导入文件替换当前全部入口数据吗？本机设置和登录状态会保留。")) return;
                      void runDataAction(() => props.onImportData("replace"));
                    }}
                  >
                    替换
                  </button>
                </article>
              </div>

              {dataBusy && <p className="data-action-message"><LoaderCircle size={14} className="spin" /> 正在处理数据文件…</p>}
              {!dataBusy && dataMessage && (
                <p className={`data-action-message ${dataMessageType === "error" ? "is-error" : ""}`}>
                  {dataMessageType === "error" ? <CircleAlert size={14} /> : <CircleCheck size={14} />}
                  {dataMessage}
                </p>
              )}
            </div>
          )}

          {tab === "sync" && (
            <div className="settings-section">
              {!props.cloudConfigured ? (
                <div className="sync-empty-state">
                  <span><CloudOff size={28} /></span>
                  <h3>尚未连接 Supabase</h3>
                  <p>应用目前完全在本地工作。配置项目 URL 和 publishable key 后，这里会启用真实邮箱验证码登录。</p>
                  <code>VITE_SUPABASE_URL</code>
                  <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
                  <p className="sync-empty-state__note">还需执行 supabase/schema.sql 并重新构建。Supabase 控制台登录不等于应用登录；两台电脑要在应用内使用同一邮箱。</p>
                  <p className="sync-empty-state__note">不要填写数据库密码、service_role 或 secret key。</p>
                </div>
              ) : props.accountEmail ? (
                <div className="sync-account">
                  <div className="sync-account__identity">
                    <span><Check size={20} /></span>
                    <div>
                      <h3>云同步已连接</h3>
                      <p>{props.accountEmail}</p>
                    </div>
                  </div>

                  <div className="sync-status-card">
                    <span className={`sync-dot ${props.syncError ? "is-error" : ""}`} />
                    <div>
                      <strong>{props.syncing ? "正在同步…" : props.syncError ? "上次同步失败" : "数据已就绪"}</strong>
                      <small>{props.syncError ?? formatSyncTime(props.lastSyncedAt)}</small>
                    </div>
                  </div>

                  <button type="button" className="button button--primary button--full" onClick={props.onSync} disabled={props.syncing}>
                    {props.syncing ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                    立即同步
                  </button>
                  <button type="button" className="button button--ghost button--full" onClick={props.onSignOut}>
                    <LogOut size={16} /> 退出同步账户
                  </button>
                </div>
              ) : (
                <div className="sync-login">
                  <div className="settings-section__intro">
                    <KeyRound size={20} />
                    <div>
                      <h3>用邮箱开启同步</h3>
                      <p>不设置密码。Windows 和 Mac 使用同一邮箱即可同步，支持验证码或邮件登录链接。</p>
                    </div>
                  </div>

                  <label className="field">
                    <span>邮箱</span>
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@example.com"
                      disabled={otpSent}
                    />
                  </label>

                  {otpSent && (
                    <label className="field">
                      <span>验证码或登录链接</span>
                      <textarea
                        value={credential}
                        onChange={(event) => setCredential(event.target.value)}
                        placeholder="输入六位验证码，或粘贴 Sign in 的原始链接"
                        spellCheck={false}
                        autoFocus
                      />
                      <small>默认邮件只有 Sign in 时，请右键复制链接地址并粘贴到这里；已经点击过的链接需要重新发送。</small>
                    </label>
                  )}

                  {authMessage && <p className="auth-message">{authMessage}</p>}

                  {otpSent ? (
                    <div className="sync-login__actions">
                      <button type="button" className="button button--ghost" onClick={() => { setOtpSent(false); setCredential(""); setAuthMessage(""); }}>
                        修改邮箱
                      </button>
                      <button type="button" className="button button--primary" onClick={handleVerifyEmailLogin} disabled={authBusy}>
                        {authBusy && <LoaderCircle size={16} className="spin" />} 验证并同步
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="button button--primary button--full" onClick={handleSendOtp} disabled={authBusy}>
                      {authBusy && <LoaderCircle size={16} className="spin" />} 发送登录邮件
                    </button>
                  )}
                </div>
              )}

              {props.cloudConfigured && (
                <div className="sync-preferences">
                  <div className="settings-divider" />
                  <div className="settings-section__intro settings-section__intro--compact">
                    <RefreshCw size={20} />
                    <div>
                      <h3>自动同步条件</h3>
                      <p>这些选项只保存在当前电脑。首次登录和手动同步不受影响。</p>
                    </div>
                  </div>

                  <label className="setting-row">
                    <span>
                      <strong>数据变更后</strong>
                      <small>新增、编辑、排序或产生启动记录后自动同步</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={props.devicePreferences.syncOnDataChange}
                      className={`switch ${props.devicePreferences.syncOnDataChange ? "is-on" : ""}`}
                      onClick={() => props.onDevicePreferencesChange({
                        syncOnDataChange: !props.devicePreferences.syncOnDataChange,
                      })}
                    >
                      <i />
                    </button>
                  </label>

                  <label className="setting-row">
                    <span>
                      <strong>网络恢复时</strong>
                      <small>离线后重新联网时检查并合并云端数据</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={props.devicePreferences.syncOnNetworkReconnect}
                      className={`switch ${props.devicePreferences.syncOnNetworkReconnect ? "is-on" : ""}`}
                      onClick={() => props.onDevicePreferencesChange({
                        syncOnNetworkReconnect: !props.devicePreferences.syncOnNetworkReconnect,
                      })}
                    >
                      <i />
                    </button>
                  </label>

                  <label className="setting-row">
                    <span>
                      <strong>窗口打开时</strong>
                      <small>从托盘或菜单栏重新打开面板时检查云端</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={props.devicePreferences.syncOnWindowOpen}
                      className={`switch ${props.devicePreferences.syncOnWindowOpen ? "is-on" : ""}`}
                      onClick={() => props.onDevicePreferencesChange({
                        syncOnWindowOpen: !props.devicePreferences.syncOnWindowOpen,
                      })}
                    >
                      <i />
                    </button>
                  </label>

                  <label className="setting-row">
                    <span>
                      <strong>退出应用前</strong>
                      <small>退出前上传尚未同步的修改，失败时询问是否继续</small>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={props.devicePreferences.syncOnExit}
                      className={`switch ${props.devicePreferences.syncOnExit ? "is-on" : ""}`}
                      onClick={() => props.onDevicePreferencesChange({
                        syncOnExit: !props.devicePreferences.syncOnExit,
                      })}
                    >
                      <i />
                    </button>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
