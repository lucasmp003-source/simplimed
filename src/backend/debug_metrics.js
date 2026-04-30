const fs = require('fs');
const path = require('path');

const METRICS_OUTPUT_DIR = path.join(__dirname, '../frontend/metrics/output');

console.log('Scanning directory:', METRICS_OUTPUT_DIR);

async function check() {
    try {
        if (!fs.existsSync(METRICS_OUTPUT_DIR)) {
            console.log('Directory does not exist!');
            return;
        }

        const families = await fs.promises.readdir(METRICS_OUTPUT_DIR, { withFileTypes: true });
        const result = {};

        for (const family of families) {
            console.log('Found family entry:', family.name, 'isDirectory:', family.isDirectory());
            if (!family.isDirectory()) continue;

            const familyPath = path.join(METRICS_OUTPUT_DIR, family.name);
            const models = await fs.promises.readdir(familyPath, { withFileTypes: true });

            const modelList = [];
            for (const model of models) {
                console.log(`  Found model entry in ${family.name}:`, model.name, 'isDirectory:', model.isDirectory());
                if (!model.isDirectory()) continue;

                const modelPath = path.join(familyPath, model.name);

                // Mimic findMetricsFile
                const candidates = ['test_metrics.json', 'test_metrics_vllm.json'];
                let foundFile = null;
                for (const candidate of candidates) {
                    const filePath = path.join(modelPath, candidate);
                    try {
                        await fs.promises.access(filePath);
                        foundFile = candidate;
                        break;
                    } catch { }
                }

                if (foundFile) {
                    console.log(`    MATCH: Found ${foundFile} for ${model.name}`);
                    modelList.push({ name: model.name, foundFile });
                } else {
                    console.log(`    WARN: No metrics file found for ${model.name}`);
                }
            }
            if (modelList.length > 0) {
                result[family.name] = modelList;
            }
        }

        console.log('Final Result Structure:', JSON.stringify(result, null, 2));

    } catch (e) {
        console.error('Error:', e);
    }
}

check();
