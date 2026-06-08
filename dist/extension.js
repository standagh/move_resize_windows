import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
const KEY_SKIP_FULLSCREEN = 'skip-fullscreen';
const KEY_UNMAXIMIZE_BEFORE_RESIZE = 'unmaximize-before-resize';
const KEY_MOVE_RESIZE_SHORTCUT = 'move-resize-shortcut';
const WINDOW_WIDTH_MARGIN = 300;
const WINDOW_HEIGHT_MARGIN = 150;
export default class MoveResizeWindowsExtension extends Extension {
    settings;
    enable() {
        this.settings = this.getSettings();
        Main.wm.addKeybinding(KEY_MOVE_RESIZE_SHORTCUT, this.settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, () => {
            this.runMoveResize();
        });
    }
    disable() {
        Main.wm.removeKeybinding(KEY_MOVE_RESIZE_SHORTCUT);
        this.settings = undefined;
    }
    runMoveResize() {
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
        const targetRect = this.computeTargetRect(workArea);
        const windows = this.getCandidateWindows(targetMonitor);
        windows.forEach(window => {
            try {
                if (!this.prepareWindow(window)) {
                    return;
                }
                const rect = this.constrainRectForWindow(window, workArea, targetRect);
                window.move_to_monitor(targetMonitor);
                window.move_frame(true, rect.x, rect.y);
                window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
                window.raise_and_make_recent_on_workspace(window.get_workspace());
            }
            catch (error) {
                logger.error(`Failed to move/resize window ${window.get_id()}:`, error);
            }
        });
    }
    getExternalMonitor() {
        const monitorManager = global.backend.get_monitor_manager();
        const monitors = monitorManager.get_monitors() ?? [];
        const externalMonitors = monitors.filter(monitor => monitor.is_active() && !monitor.is_virtual() && !monitor.is_builtin());
        if (externalMonitors.length === 0) {
            return null;
        }
        let externalMonitorIndex = null;
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
    getCandidateWindows(targetMonitor) {
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
        const uniqueWindows = new Map();
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
    isMovableWindow(window) {
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
    prepareWindow(window) {
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
    computeTargetRect(workArea) {
        const width = Math.max(1, workArea.width - WINDOW_WIDTH_MARGIN);
        const height = Math.max(1, workArea.height - WINDOW_HEIGHT_MARGIN);
        return {
            x: workArea.x + Math.floor((workArea.width - width) / 2),
            y: workArea.y + Math.floor((workArea.height - height) / 2),
            width,
            height,
        };
    }
    constrainRectForWindow(window, workArea, rect) {
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
        return {
            x: workArea.x + Math.floor((workArea.width - width) / 2),
            y: workArea.y + Math.floor((workArea.height - height) / 2),
            width,
            height,
        };
    }
}
