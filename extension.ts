import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const KEY_SKIP_FULLSCREEN = 'skip-fullscreen';
const KEY_UNMAXIMIZE_BEFORE_RESIZE = 'unmaximize-before-resize';
const KEY_MOVE_RESIZE_SHORTCUT = 'move-resize-shortcut';
const KEY_WINDOW_WIDTH_OVERRIDES = 'window-width-overrides';
const KEY_WINDOW_HEIGHT_OVERRIDES = 'window-height-overrides';
const WINDOW_WIDTH_MARGIN = 300;
const WINDOW_HEIGHT_MARGIN = 150;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default class MoveResizeWindowsExtension extends Extension {
  private settings?: Gio.Settings;

  override enable(): void {
    this.settings = this.getSettings();

    Main.wm.addKeybinding(
      KEY_MOVE_RESIZE_SHORTCUT,
      this.settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.NORMAL,
      () => {
        this.runMoveResize();
      },
    );
  }

  override disable(): void {
    Main.wm.removeKeybinding(KEY_MOVE_RESIZE_SHORTCUT);
    this.settings = undefined;
  }

  private runMoveResize(): void {
    if (!this.settings) {
      return;
    }

    const logger = this.getLogger();
    const targetMonitor = this.getExternalMonitor();

    if (targetMonitor === null) {
      logger.debug('No external monitor detected, skipping move/resize run.');
      return;
    }

    const activeWorkspace = global.workspace_manager.get_active_workspace();
    const workArea = activeWorkspace.get_work_area_for_monitor(targetMonitor);
    const monitorRect = this.getMonitorRect(targetMonitor);
    const targetRect = this.computeTargetRect(monitorRect);
    const windows = this.getCandidateWindows(targetMonitor);

    windows.forEach(window => {
      try {
        if (!this.prepareWindow(window)) {
          return;
        }

        const rect = this.constrainRectForWindow(window, monitorRect, workArea, targetRect);

        window.move_to_monitor(targetMonitor);
        window.move_frame(true, rect.x, rect.y);
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
        window.raise_and_make_recent_on_workspace(window.get_workspace());
      } catch (error) {
        logger.error(`Failed to move/resize window ${window.get_id()}:`, error);
      }
    });
  }

  private getExternalMonitor(): number | null {
    const monitorManager = global.backend.get_monitor_manager();
    const monitors = monitorManager.get_monitors() ?? [];
    const externalMonitors = monitors.filter(monitor => monitor.is_active() && !monitor.is_virtual() && !monitor.is_builtin());

    if (externalMonitors.length === 0) {
      return null;
    }

    let externalMonitorIndex: number | null = null;
    let largestArea = -1;

    for (const monitor of externalMonitors) {
      const monitorIndex = monitorManager.get_monitor_for_connector(monitor.get_connector());
      if (monitorIndex < 0) {
        continue;
      }

      const geometry = global.display.get_monitor_geometry(monitorIndex);
      const area = geometry.width * geometry.height;

      if (area > largestArea) {
        externalMonitorIndex = monitorIndex;
        largestArea = area;
      }
    }

    return externalMonitorIndex;
  }

  private getMonitorRect(monitorIndex: number): Rect {
    const geometry = global.display.get_monitor_geometry(monitorIndex);

    return {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    };
  }

  private getCandidateWindows(targetMonitor: number): Meta.Window[] {
    const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
    const uniqueWindows = new Map<number, Meta.Window>();

    for (const window of windows) {
      if (window.get_monitor() === targetMonitor) {
        continue;
      }

      if (this.isMovableWindow(window)) {
        uniqueWindows.set(window.get_id(), window);
      }
    }

    return [...uniqueWindows.values()];
  }

  private isMovableWindow(window: Meta.Window): boolean {
    if (window.minimized || window.is_override_redirect() || window.is_skip_taskbar() || window.is_attached_dialog()) {
      return false;
    }

    const windowType = window.get_window_type();

    return [
      Meta.WindowType.NORMAL,
      Meta.WindowType.DIALOG,
      Meta.WindowType.MODAL_DIALOG,
      Meta.WindowType.UTILITY,
    ].includes(windowType);
  }

  private prepareWindow(window: Meta.Window): boolean {
    const skipFullscreen = this.settings?.get_boolean(KEY_SKIP_FULLSCREEN) ?? true;
    const unmaximizeBeforeResize = this.settings?.get_boolean(KEY_UNMAXIMIZE_BEFORE_RESIZE) ?? true;

    if (window.is_fullscreen()) {
      if (skipFullscreen) {
        return false;
      }

      window.unmake_fullscreen();
    }

    if (unmaximizeBeforeResize && window.is_maximized()) {
      window.unmaximize();
    }

    return true;
  }

  private computeTargetRect(monitorRect: Rect): Rect {
    const defaultWidth = Math.max(1, monitorRect.width - WINDOW_WIDTH_MARGIN);
    const defaultHeight = Math.max(1, monitorRect.height - WINDOW_HEIGHT_MARGIN);
    const width = this.getConfiguredDimension(KEY_WINDOW_WIDTH_OVERRIDES, monitorRect, defaultWidth);
    const height = this.getConfiguredDimension(KEY_WINDOW_HEIGHT_OVERRIDES, monitorRect, defaultHeight);

    return this.centerRect(monitorRect, width, height);
  }

  private getConfiguredDimension(key: string, monitorRect: Pick<Rect, 'width' | 'height'>, defaultValue: number): number {
    const override = this.getSizeOverrides(key)[this.getResolutionKey(monitorRect)];

    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
      return Math.floor(override);
    }

    return defaultValue;
  }

  private getSizeOverrides(key: string): Record<string, number> {
    const value = this.settings?.get_value(key).deepUnpack();

    if (typeof value === 'object' && value !== null) {
      return value as Record<string, number>;
    }

    return {};
  }

  private getResolutionKey(rect: Pick<Rect, 'width' | 'height'>): string {
    return `${rect.width}x${rect.height}`;
  }

  private constrainRectForWindow(window: Meta.Window, monitorRect: Rect, workArea: Rect, rect: Rect): Rect {
    let width = Math.min(rect.width, workArea.width);
    let height = Math.min(rect.height, workArea.height);

    const [hasMinSize, minWidth, minHeight] = window.get_min_size();
    if (hasMinSize) {
      width = Math.max(width, minWidth);
      height = Math.max(height, minHeight);
    }

    const [hasMaxSize, maxWidth, maxHeight] = window.get_max_size();
    if (hasMaxSize) {
      if (maxWidth > 0) {
        width = Math.min(width, maxWidth);
      }

      if (maxHeight > 0) {
        height = Math.min(height, maxHeight);
      }
    }

    width = Math.min(Math.max(1, width), workArea.width);
    height = Math.min(Math.max(1, height), workArea.height);

    const centeredOnMonitor = this.centerRect(monitorRect, width, height);

    if (this.isRectWithinBounds(centeredOnMonitor, workArea)) {
      return centeredOnMonitor;
    }

    return this.centerRect(workArea, width, height);
  }

  private centerRect(bounds: Rect, width: number, height: number): Rect {
    return {
      x: bounds.x + Math.floor((bounds.width - width) / 2),
      y: bounds.y + Math.floor((bounds.height - height) / 2),
      width,
      height,
    };
  }

  private isRectWithinBounds(rect: Rect, bounds: Rect): boolean {
    return rect.x >= bounds.x
      && rect.y >= bounds.y
      && rect.x + rect.width <= bounds.x + bounds.width
      && rect.y + rect.height <= bounds.y + bounds.height;
  }
}
