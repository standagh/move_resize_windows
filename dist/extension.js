import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
export default class MyExtension extends Extension {
    gsettings;
    animationsEnabled = true;
    enable() {
        this.gsettings = this.getSettings();
        this.animationsEnabled = this.gsettings.get_boolean('animate') ?? true;
    }
    disable() {
        this.gsettings = undefined;
    }
}
