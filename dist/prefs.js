import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
const KEY_SKIP_FULLSCREEN = 'skip-fullscreen';
const KEY_UNMAXIMIZE_BEFORE_RESIZE = 'unmaximize-before-resize';
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
            description: _('When the shortcut runs, windows that are still on another monitor are moved to the detected external display, resized to the external work area minus 300 px width and 150 px height, and centered there.'),
        });
        page.add(overviewGroup);
        overviewGroup.add(this.createInfoRow(_('Target monitor'), _('The extension detects non-built-in monitors and uses the largest active external display as the target.')));
        overviewGroup.add(this.createInfoRow(_('Affected windows'), _('Only regular app windows that are not already on the external monitor are changed.')));
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
}
