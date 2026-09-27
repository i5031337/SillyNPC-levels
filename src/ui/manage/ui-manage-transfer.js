import { Popup } from '../../../../../../popup.js';
import { LOG_PREFIX } from '../../core/constants.js';
import { exportSettingsData, importSettingsData } from '../../core/settings.js';
import { offerDownload } from '../../core/utils.js';

export function exportData() {
    offerDownload(exportSettingsData(),
        `sillynpc-export-${new Date().toISOString().slice(0, 10)}.json`);
}

export async function importData(refreshView) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const confirm = await Popup.show.confirm('Import Data', 'This will overwrite your current SillyNPC characters and settings. Continue?');
            if (!confirm) return;

            importSettingsData(text);
            refreshView();
            toastr.success('Imported successfully.');
        } catch (err) {
            console.error(LOG_PREFIX, 'Import failed', err);
            toastr.error(`Import failed: ${err.message}`);
        }
    };
    input.click();
}
