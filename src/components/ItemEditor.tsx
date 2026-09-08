import { useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  File,
  Folder,
  FolderOpen,
  FolderKanban,
  Globe2,
  Image,
  Layers3,
  LoaderCircle,
  Pin,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { createId } from "../lib/id";
import { isSupportedWebTarget } from "../lib/launcher";
import { isTauriRuntime } from "../lib/platform";
import { setNativeDialogOpen } from "../lib/nativeDialog";
import {
  DEFAULT_LINKED_TARGET_DELAY_MS,
  fallbackIconForKind,
  inferLaunchKind,
  nameFromTargetPath,
  normalizeLaunchItem,
} from "../lib/targets";
import type {
  Category,
  DesktopPlatform,
  LaunchAction,
  LaunchItem,
  LaunchKind,
  LaunchTarget,
  PlatformScope,
} from "../types";
import { isImageIcon, LaunchIcon } from "./LaunchIcon";

interface ItemEditorProps {
  item: LaunchItem | null;
  categories: Category[];
  platform: DesktopPlatform;
  onClose: () => void;
  onSave: (item: LaunchItem) => void;
  onDelete: (itemId: string) => void;
}

const colors = ["#7c8cff", "#aa83ff", "#4cc9a4", "#49b8d8", "#ffad66", "#ff7e8b", "#a9b36b"];

const kindOptions: Array<{ value: LaunchKind; label: string; icon: typeof Globe2 }> = [
  { value: "url", label: "网页", icon: Globe2 },
  { value: "application", label: "应用", icon: AppWindow },
  { value: "project", label: "项目", icon: FolderKanban },
  { value: "folder", label: "文件夹", icon: Folder },
  { value: "file", label: "文件", icon: File },
];

function createEmptyItem(categoryId: string): LaunchItem {
  const now = new Date().toISOString();
  return {
    id: createId(),
    name: "",
    description: "",
    icon: "✦",
    color: colors[0],
    kind: "url",
    scope: "all",
    url: "https://",
    targets: {},
    linkedTargets: [],
    aliases: [],
    categoryId,
    frequent: true,
    favorite: false,
    sortOrder: Date.now(),
    createdAt: now,
    updatedAt: now,
  };
}

function createEmptyAction(): LaunchAction {
  return {
    id: createId(),
    name: "新目标",
    kind: "url",
    scope: "all",
    url: "https://",
    targets: {},
    includeInBatch: true,
    delayMs: DEFAULT_LINKED_TARGET_DELAY_MS,
  };
}

function windowsTargetPlaceholder(kind: LaunchKind): string {
  if (kind === "application") return "C:\\Program Files\\App\\App.exe";
  if (kind === "project") return "D:\\code\\MyProject";
  if (kind === "folder") return "D:\\Documents";
  return "D:\\Documents\\file.txt";
}

function macTargetPlaceholder(kind: LaunchKind): string {
  if (kind === "application") return "/Applications/App.app";
  if (kind === "project") return "/Users/name/code/MyProject";
  if (kind === "folder") return "/Users/name/Documents";
  return "/Users/name/Documents/file.txt";
}

function validateTarget(
  target: Pick<LaunchAction, "name" | "kind" | "scope" | "url" | "targets">,
  label: string,
): string | null {
  if (!target.name.trim()) return `${label}需要填写名称`;
  if (target.kind === "url") {
    return target.url && isSupportedWebTarget(target.url)
      ? null
      : `${label}的网页地址需要以 http://、https:// 或 file:/// 开头`;
  }

  const windowsTarget = target.targets.windows?.value.trim();
  const macTarget = target.targets.macos?.value.trim();
  if (target.scope === "windows" && !windowsTarget) return `${label}需要填写 Windows 目标`;
  if (target.scope === "macos" && !macTarget) return `${label}需要填写 macOS 目标`;
  if (target.scope === "all" && !windowsTarget && !macTarget) return `${label}至少需要填写一个系统目标`;
  return null;
}

export function ItemEditor({ item, categories, platform, onClose, onSave, onDelete }: ItemEditorProps) {
  const [draft, setDraft] = useState<LaunchItem>(() => item
    ? normalizeLaunchItem(item)
    : createEmptyItem(categories[0]?.id ?? ""));
  const [aliasesText, setAliasesText] = useState(() => (item?.aliases ?? []).join("，"));
  const [error, setError] = useState("");
  const [iconLoadingFor, setIconLoadingFor] = useState<string | null>(null);
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const activeCategories = useMemo(() => categories.filter((category) => !category.deletedAt), [categories]);

  useEffect(() => {
    setDraft(item
      ? normalizeLaunchItem(item)
      : createEmptyItem(activeCategories[0]?.id ?? ""));
    setAliasesText((item?.aliases ?? []).join("，"));
    setError("");
    setIconLoadingFor(null);
    setPickingFor(null);
  }, [item, activeCategories]);

  const updateTarget = (platformName: "windows" | "macos", patch: Partial<LaunchTarget>) => {
    setDraft((current) => ({
      ...current,
      targets: {
        ...current.targets,
        [platformName]: { value: "", arguments: "", ...current.targets[platformName], ...patch },
      },
    }));
  };

  const updateLinkedAction = (actionId: string, patch: Partial<LaunchAction>) => {
    setDraft((current) => ({
      ...current,
      linkedTargets: (current.linkedTargets ?? []).map((action) =>
        action.id === actionId ? { ...action, ...patch } : action,
      ),
    }));
  };

  const updateLinkedTarget = (actionId: string, platformName: "windows" | "macos", patch: Partial<LaunchTarget>) => {
    setDraft((current) => ({
      ...current,
      linkedTargets: (current.linkedTargets ?? []).map((action) =>
        action.id === actionId
          ? {
              ...action,
              targets: {
                ...action.targets,
                [platformName]: { value: "", arguments: "", ...action.targets[platformName], ...patch },
              },
            }
          : action,
      ),
    }));
  };

  const moveLinkedAction = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const actions = [...(current.linkedTargets ?? [])];
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= actions.length) return current;
      [actions[index], actions[nextIndex]] = [actions[nextIndex], actions[index]];
      return { ...current, linkedTargets: actions };
    });
  };

  const readTargetIcon = async (targetValue: string | undefined, actionId?: string) => {
    const target = targetValue?.trim();
    if (!target) return setError("请先选择或填写应用目标");
    if (!isTauriRuntime()) return setError("目标图标只能在桌面应用中读取");

    const loadingKey = actionId ?? "primary";
    setIconLoadingFor(loadingKey);
    setError("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const icon = await invoke<string | null>("extract_target_icon", { target });
      if (!icon) throw new Error("这个目标没有可读取的应用图标");
      if (actionId) updateLinkedAction(actionId, { icon });
      else setDraft((current) => ({ ...current, icon }));
    } catch (iconError) {
      setError(iconError instanceof Error ? iconError.message : String(iconError));
    } finally {
      setIconLoadingFor(null);
    }
  };

  const pickNativeTarget = async (
    platformName: "windows" | "macos",
    kind: LaunchKind,
    actionId?: string,
  ) => {
    if (!isTauriRuntime()) return setError("系统文件选择只能在桌面应用中使用");
    if (platform !== platformName) return setError(`请在 ${platformName === "windows" ? "Windows" : "macOS"} 设备上选择本机目标`);

    const pickKey = actionId ? `${actionId}-${platformName}` : `primary-${platformName}`;
    const selectedDirectory = kind === "project" || kind === "folder";
    setPickingFor(pickKey);
    setError("");
    setNativeDialogOpen(true);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: false,
        directory: selectedDirectory,
        title: selectedDirectory ? "选择文件夹" : "选择应用或文件",
        filters: kind === "application"
          ? [{
              name: "应用程序",
              extensions: platformName === "windows" ? ["exe", "com", "bat", "cmd", "lnk"] : ["app"],
            }]
          : undefined,
      });
      if (typeof selected !== "string") return;

      const inferredKind = inferLaunchKind(selected, selectedDirectory, kind);
      const inferredName = nameFromTargetPath(selected, inferredKind);
      const inferredIcon = fallbackIconForKind(inferredKind);
      if (actionId) {
        setDraft((current) => ({
          ...current,
          linkedTargets: (current.linkedTargets ?? []).map((action) => action.id === actionId
            ? {
                ...action,
                kind: inferredKind,
                name: !action.name.trim() || action.name === "新目标" ? inferredName : action.name,
                icon: inferredIcon,
                targets: {
                  ...action.targets,
                  [platformName]: { value: selected, arguments: "" },
                },
              }
            : action),
        }));
      } else {
        setDraft((current) => ({
          ...current,
          kind: inferredKind,
          name: current.name.trim() ? current.name : inferredName,
          icon: inferredIcon,
          targets: {
            ...current.targets,
            [platformName]: { value: selected, arguments: "" },
          },
        }));
      }

      if (inferredKind === "application") {
        await readTargetIcon(selected, actionId);
      }
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : String(pickError));
    } finally {
      setNativeDialogOpen(false);
      setPickingFor(null);
    }
  };

  const renderPlatformTarget = (
    platformName: "windows" | "macos",
    kind: LaunchKind,
    target: LaunchTarget | undefined,
    actionId?: string,
  ) => {
    const platformLabel = platformName === "windows" ? "Windows" : "macOS";
    const loadingKey = actionId ?? "primary";
    const pickKey = actionId ? `${actionId}-${platformName}` : `primary-${platformName}`;
    const update = (patch: Partial<LaunchTarget>) => actionId
      ? updateLinkedTarget(actionId, platformName, patch)
      : updateTarget(platformName, patch);

    return (
      <div className="target-platform-fields">
        <div className="target-field-row">
          <label className="field field--grow">
            <span>{platformLabel} 路径</span>
            <input
              value={target?.value ?? ""}
              onChange={(event) => update({ value: event.target.value })}
              placeholder={platformName === "windows" ? windowsTargetPlaceholder(kind) : macTargetPlaceholder(kind)}
            />
          </label>
          {platform === platformName && (
            <button
              type="button"
              className="button button--secondary target-picker-button"
              onClick={() => void pickNativeTarget(platformName, kind, actionId)}
              disabled={pickingFor === pickKey}
            >
              {pickingFor === pickKey ? <LoaderCircle size={15} className="spin" /> : <FolderOpen size={15} />}
              选择
            </button>
          )}
          {platform === platformName && kind === "application" && target?.value && (
            <button
              type="button"
              className="button button--secondary target-icon-button"
              onClick={() => void readTargetIcon(target.value, actionId)}
              disabled={iconLoadingFor === loadingKey}
            >
              {iconLoadingFor === loadingKey ? <LoaderCircle size={15} className="spin" /> : <Image size={15} />}
              图标
            </button>
          )}
        </div>
        {kind === "application" && (
          <label className="field target-arguments-field">
            <span>启动参数 <small>可选；与程序路径分开保存</small></span>
            <input
              value={target?.arguments ?? ""}
              onChange={(event) => update({ arguments: event.target.value })}
              placeholder="例如：--open 或 --profile work"
            />
          </label>
        )}
      </div>
    );
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return setError("请填写入口名称");
    if (!draft.categoryId) return setError("请先创建一个分类");

    const primaryError = validateTarget({ ...draft, name }, "主目标");
    if (primaryError) return setError(primaryError);
    for (let index = 0; index < (draft.linkedTargets ?? []).length; index += 1) {
      const actionError = validateTarget(draft.linkedTargets![index], `绑定目标 ${index + 1}`);
      if (actionError) return setError(actionError);
    }

    onSave({
      ...draft,
      name,
      description: draft.description.trim(),
      aliases: aliasesText.split(/[,，\n]/).map((alias) => alias.trim()).filter(Boolean),
      url: draft.kind === "url" ? draft.url?.trim() : undefined,
      linkedTargets: draft.linkedTargets?.length
        ? draft.linkedTargets.map((action) => ({
            ...action,
            name: action.name.trim(),
            url: action.kind === "url" ? action.url?.trim() : undefined,
          }))
        : undefined,
      updatedAt: new Date().toISOString(),
    });
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal item-editor" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <header className="modal__header">
          <div>
            <span className="eyebrow">LAUNCH ITEM</span>
            <h2 id="editor-title">{item ? "编辑入口" : "添加新入口"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={19} />
          </button>
        </header>

        <form onSubmit={submit} className="editor-form">
          <div className="editor-form__body">
          <div className="editor-identity">
            <label className="icon-field">
              <span>图标</span>
              <span className="icon-field__control">
                <LaunchIcon icon={draft.icon} fallback={draft.name || "✦"} className="icon-field__preview" />
                <input
                  value={isImageIcon(draft.icon) ? "" : draft.icon}
                  maxLength={4}
                  placeholder={isImageIcon(draft.icon) ? "图片" : "✦"}
                  onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
                  aria-label="入口图标"
                />
              </span>
            </label>
            <label className="field field--grow">
              <span>名称</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：项目控制台"
                autoFocus
              />
            </label>
          </div>

          <label className="field">
            <span>一句说明 <small>可选</small></span>
            <input
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="帮助你快速辨认这个入口"
            />
          </label>

          <label className="field">
            <span>搜索别名 <small>可选；使用逗号分隔</small></span>
            <input
              value={aliasesText}
              onChange={(event) => setAliasesText(event.target.value)}
              placeholder="例如：坦克，wot，游戏启动器"
            />
          </label>

          <fieldset className="segmented-field">
            <legend>主目标类型</legend>
            <div className="segmented-control segmented-control--types">
              {kindOptions.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={draft.kind === option.value ? "is-active" : ""}
                    onClick={() => setDraft({ ...draft, kind: option.value, scope: option.value === "url" ? "all" : draft.scope })}
                  >
                    <Icon size={15} /> {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {draft.kind === "url" ? (
            <label className="field">
              <span>网页地址</span>
              <input
                value={draft.url ?? ""}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                placeholder="https://example.com 或 file:///D:/project/index.html"
                inputMode="url"
              />
            </label>
          ) : (
            <>
              <label className="field">
                <span>可用平台</span>
                <select
                  value={draft.scope}
                  onChange={(event) => setDraft({ ...draft, scope: event.target.value as PlatformScope })}
                >
                  <option value="all">Windows 与 macOS</option>
                  <option value="windows">仅 Windows</option>
                  <option value="macos">仅 macOS</option>
                </select>
              </label>

              {(draft.scope === "all" || draft.scope === "windows") && (
                renderPlatformTarget("windows", draft.kind, draft.targets.windows)
              )}

              {(draft.scope === "all" || draft.scope === "macos") && (
                renderPlatformTarget("macos", draft.kind, draft.targets.macos)
              )}
            </>
          )}

          <section className="linked-targets-editor">
            <header>
              <span className="linked-targets-editor__heading">
                <Layers3 size={16} />
                <span>
                  <strong>组合启动</strong>
                  <small>点击卡片时先打开主目标，再依次打开下列目标</small>
                </span>
              </span>
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setDraft((current) => ({
                  ...current,
                  linkedTargets: [...(current.linkedTargets ?? []), createEmptyAction()],
                }))}
              >
                <Plus size={14} /> 绑定目标
              </button>
            </header>

            {(draft.linkedTargets ?? []).map((action, index) => (
              <div className="linked-target-editor" key={action.id}>
                <div className="linked-target-editor__header">
                  <span className="sequence-number">{index + 2}</span>
                  <LaunchIcon icon={action.icon} fallback={action.name} className="linked-target-editor__icon" />
                  <label className="field field--grow">
                    <span>目标名称</span>
                    <input
                      value={action.name}
                      onChange={(event) => updateLinkedAction(action.id, { name: event.target.value })}
                      placeholder="例如：语音工具"
                    />
                  </label>
                  <span className="linked-target-editor__actions">
                    {(platform === "windows" || platform === "macos") && action.kind === "application" && action.targets[platform]?.value && (
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => void readTargetIcon(action.targets[platform]?.value, action.id)}
                        disabled={iconLoadingFor === action.id}
                        aria-label="读取这个目标的应用图标"
                      >
                        {iconLoadingFor === action.id ? <LoaderCircle size={14} className="spin" /> : <Image size={14} />}
                      </button>
                    )}
                    <button type="button" className="icon-button" onClick={() => moveLinkedAction(index, -1)} disabled={index === 0} aria-label="上移">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" className="icon-button" onClick={() => moveLinkedAction(index, 1)} disabled={index === (draft.linkedTargets?.length ?? 0) - 1} aria-label="下移">
                      <ArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button--danger"
                      onClick={() => setDraft((current) => ({
                        ...current,
                        linkedTargets: (current.linkedTargets ?? []).filter((entry) => entry.id !== action.id),
                      }))}
                      aria-label="移除绑定目标"
                    >
                      <Trash2 size={14} />
                    </button>
                  </span>
                </div>

                <label className="batch-toggle">
                  <span>
                    <strong>参与组合启动</strong>
                    <small>关闭后仍会显示在卡片列表中，也可以单独打开</small>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={action.includeInBatch !== false}
                    className={`switch ${action.includeInBatch !== false ? "is-on" : ""}`}
                    onClick={() => updateLinkedAction(action.id, { includeInBatch: action.includeInBatch === false })}
                  >
                    <i />
                  </button>
                </label>

                <div className="linked-target-editor__selectors">
                  <label className="field field--grow">
                    <span>类型</span>
                    <select
                      value={action.kind}
                      onChange={(event) => {
                        const kind = event.target.value as LaunchKind;
                        updateLinkedAction(action.id, { kind, scope: kind === "url" ? "all" : action.scope });
                      }}
                    >
                      {kindOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  {action.kind !== "url" && (
                    <label className="field field--grow">
                      <span>平台</span>
                      <select value={action.scope} onChange={(event) => updateLinkedAction(action.id, { scope: event.target.value as PlatformScope })}>
                        <option value="all">Windows 与 macOS</option>
                        <option value="windows">仅 Windows</option>
                        <option value="macos">仅 macOS</option>
                      </select>
                    </label>
                  )}
                  <label className="field linked-target-delay-field">
                    <span>启动前延迟</span>
                    <span className="delay-input">
                      <input
                        type="number"
                        min="0"
                        max="60"
                        step="0.5"
                        value={(action.delayMs ?? DEFAULT_LINKED_TARGET_DELAY_MS) / 1000}
                        onChange={(event) => updateLinkedAction(action.id, {
                          delayMs: Math.max(0, Math.min(60, Number(event.target.value) || 0)) * 1000,
                        })}
                      />
                      <small>秒</small>
                    </span>
                  </label>
                </div>

                {action.kind === "url" ? (
                  <label className="field">
                    <span>网页地址</span>
                    <input value={action.url ?? ""} onChange={(event) => updateLinkedAction(action.id, { url: event.target.value })} placeholder="https://example.com" />
                  </label>
                ) : (
                  <>
                    {(action.scope === "all" || action.scope === "windows") && (
                      renderPlatformTarget("windows", action.kind, action.targets.windows, action.id)
                    )}
                    {(action.scope === "all" || action.scope === "macos") && (
                      renderPlatformTarget("macos", action.kind, action.targets.macos, action.id)
                    )}
                  </>
                )}
              </div>
            ))}

            {!(draft.linkedTargets?.length) && (
              <p className="linked-targets-editor__empty">保持空白时仍是普通单目标卡片。</p>
            )}
          </section>

          <div className="editor-row">
            <label className="field field--grow">
              <span>分类</span>
              <select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>

            <div className="entry-flags">
              <button
                type="button"
                className={`favorite-toggle favorite-toggle--frequent ${draft.frequent ? "is-active" : ""}`}
                onClick={() => setDraft({ ...draft, frequent: !draft.frequent })}
              >
                <Pin size={16} fill={draft.frequent ? "currentColor" : "none"} />
                常用
              </button>
              <button
                type="button"
                className={`favorite-toggle ${draft.favorite ? "is-active" : ""}`}
                onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}
              >
                <Star size={16} fill={draft.favorite ? "currentColor" : "none"} />
                收藏
              </button>
            </div>
          </div>

          <fieldset className="color-picker">
            <legend>强调色</legend>
            <div>
              {colors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={draft.color === color ? "is-active" : ""}
                  style={{ background: color }}
                  onClick={() => setDraft({ ...draft, color })}
                  aria-label={`选择颜色 ${color}`}
                />
              ))}
            </div>
          </fieldset>

          {error && <p className="form-error">{error}</p>}
          </div>

          <footer className="modal__footer">
            {item ? (
              <button
                type="button"
                className="button button--danger-ghost"
                onClick={() => {
                  if (window.confirm(`确定删除“${item.name}”吗？`)) onDelete(item.id);
                }}
              >
                <Trash2 size={15} /> 删除
              </button>
            ) : <span />}
            <div>
              <button type="button" className="button button--ghost" onClick={onClose}>取消</button>
              <button type="submit" className="button button--primary">保存入口</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}
