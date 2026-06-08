import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
const KEY_SKIP_FULLSCREEN = 'skip-fullscreen';
const KEY_UNMAXIMIZE_BEFORE_RESIZE = 'unmaximize-before-resize';
const KEY_WINDOW_WIDTH_OVERRIDES = 'window-width-overrides';
const KEY_WINDOW_HEIGHT_OVERRIDES = 'window-height-overrides';
const WINDOW_WIDTH_MARGIN = 300;
const WINDOW_HEIGHT_MARGIN = 150;
const BUILTIN_CONNECTOR_PATTERN = /^(eDP|LVDS|DSI)/i;
export default class MoveResizeWindowsPreferences extends ExtensionPreferences {
    settings;
    fillPreferencesWindow(window) {
        this.settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: _('General'),
            iconName: 'video-display-symbolic',
        });
        const overviewGroup = new Adw.PreferencesGroup({
            title: _('How it works'),
            description: _('When the shortcut runs, windows that are still on another monitor are moved to the detected external display, resized to the external monitor size minus 300 px width and 150 px height, and centered there.'),
        });
        page.add(overviewGroup);
        overviewGroup.add(this.createInfoRow(_('Target monitor'), _('The extension detects non-built-in monitors and uses the largest active external display as the target.')));
        overviewGroup.add(this.createInfoRow(_('Affected windows'), _('Only regular app windows that are not already on the external monitor are changed.')));
        const targetMonitor = this.getExternalMonitorRect();
        const sizeGroup = new Adw.PreferencesGroup({
            title: _('Window size'),
            description: targetMonitor
                ? `Overrides are saved only for the currently detected external monitor resolution: ${targetMonitor.width} × ${targetMonitor.height}.`
                : _('Connect an external monitor to set width and height overrides for its resolution.'),
        });
        page.add(sizeGroup);
        if (targetMonitor) {
            sizeGroup.add(this.createWindowSizeRow(_('Window width'), KEY_WINDOW_WIDTH_OVERRIDES, targetMonitor, this.getDefaultDimension(targetMonitor.width, WINDOW_WIDTH_MARGIN)));
            sizeGroup.add(this.createWindowSizeRow(_('Window height'), KEY_WINDOW_HEIGHT_OVERRIDES, targetMonitor, this.getDefaultDimension(targetMonitor.height, WINDOW_HEIGHT_MARGIN)));
        }
        else {
            sizeGroup.add(this.createInfoRow(_('No external monitor detected'), _('Open preferences while the external monitor is connected to store size overrides for that resolution.')));
        }
        const behaviorGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
            description: _('Optional safeguards for windows that cannot be resized cleanly.'),
        });
        page.add(behaviorGroup);
        behaviorGroup.add(this.createSwitchRow(_('Skip fullscreen windows'), _('Leave fullscreen windows unchanged.'), KEY_SKIP_FULLSCREEN));
        behaviorGroup.add(this.createSwitchRow(_('Unmaximize before resize'), _('Automatically unmaximize windows before applying the centered size.'), KEY_UNMAXIMIZE_BEFORE_RESIZE));
        const shortcutGroup = new Adw.PreferencesGroup({
            title: _('Shortcut'),
            description: _('Default shortcut: Super+Shift+M.'),
        });
        page.add(shortcutGroup);
        shortcutGroup.add(this.createInfoRow(_('Run action'), _('Press Super+Shift+M to move notebook-screen windows to the external monitor.')));
        window.add(page);
        return Promise.resolve();
    }
    createInfoRow(title, subtitle) {
        return new Adw.ActionRow({
            title,
            subtitle,
            activatable: false,
        });
    }
    createSwitchRow(title, subtitle, key) {
        const row = new Adw.SwitchRow({
            title,
            subtitle,
        });
        this.settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }
    createWindowSizeRow(title, key, monitorRect, defaultValue) {
        const maximumValue = key === KEY_WINDOW_WIDTH_OVERRIDES ? monitorRect.width : monitorRect.height;
        const row = Adw.SpinRow.new_with_range(1, Math.max(1, maximumValue), 1);
        row.title = title;
        row.subtitle = this.getWindowSizeSubtitle(key, monitorRect, defaultValue);
        row.digits = 0;
        row.numeric = true;
        row.snapToTicks = true;
        row.value = this.getOverrideValue(key, monitorRect) ?? defaultValue;
        row.connect('notify::value', () => {
            const value = Math.max(1, Math.round(row.value));
            if (value !== row.value) {
                row.value = value;
                return;
            }
            this.setOverrideValue(key, monitorRect, value === defaultValue ? null : value);
            row.subtitle = this.getWindowSizeSubtitle(key, monitorRect, defaultValue);
        });
        return row;
    }
    getWindowSizeSubtitle(key, monitorRect, defaultValue) {
        const overrideValue = this.getOverrideValue(key, monitorRect);
        const resolutionLabel = `${monitorRect.width} × ${monitorRect.height}`;
        if (overrideValue !== null) {
            return `Saved for ${resolutionLabel}. Default is ${defaultValue} px.`;
        }
        return `Default for ${resolutionLabel}: ${defaultValue} px.`;
    }
    getExternalMonitorRect() {
        const display = Gdk.Display.get_default();
        if (!display) {
            return null;
        }
        const monitors = display.get_monitors();
        let targetMonitor = null;
        let largestArea = -1;
        for (let index = 0; index < monitors.get_n_items(); index += 1) {
            const monitor = monitors.get_item(index);
            if (!(monitor instanceof Gdk.Monitor) || !monitor.valid || this.isBuiltinMonitor(monitor)) {
                continue;
            }
            const geometry = monitor.get_geometry();
            const area = geometry.width * geometry.height;
            if (area > largestArea) {
                largestArea = area;
                targetMonitor = {
                    x: geometry.x,
                    y: geometry.y,
                    width: geometry.width,
                    height: geometry.height,
                };
            }
        }
        return targetMonitor;
    }
    isBuiltinMonitor(monitor) {
        const connector = monitor.get_connector();
        return connector !== null && BUILTIN_CONNECTOR_PATTERN.test(connector);
    }
    getDefaultDimension(monitorDimension, margin) {
        return Math.max(1, monitorDimension - margin);
    }
    getOverrideValue(key, monitorRect) {
        const overrideValue = this.getOverrides(key)[this.getResolutionKey(monitorRect)];
        if (typeof overrideValue === 'number' && Number.isFinite(overrideValue) && overrideValue > 0) {
            return Math.floor(overrideValue);
        }
        return null;
    }
    setOverrideValue(key, monitorRect, value) {
        const overrides = this.getOverrides(key);
        const resolutionKey = this.getResolutionKey(monitorRect);
        if (value === null) {
            delete overrides[resolutionKey];
        }
        else {
            overrides[resolutionKey] = value;
        }
        this.settings.set_value(key, new GLib.Variant('a{si}', overrides));
    }
    getOverrides(key) {
        const value = this.settings.get_value(key).deepUnpack();
        if (typeof value === 'object' && value !== null) {
            return { ...value };
        }
        return {};
    }
    getResolutionKey(rect) {
        return `${rect.width}x${rect.height}`;
    }
}
