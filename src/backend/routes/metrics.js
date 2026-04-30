const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

module.exports = function (deps) {
    const { requireServerAuth, requireMetricsRole } = deps.authMiddleware;

    const METRICS_OUTPUT_DIR = path.join(__dirname, '../../frontend/metrics/output');

    // Helper function to check if file exists
    async function fileExists(filePath) {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    // Helper function to find metrics file
    async function findMetricsFile(experimentPath) {
        const candidates = ['test_metrics.json', 'test_metrics_vllm.json'];
        for (const candidate of candidates) {
            const filePath = path.join(experimentPath, candidate);
            if (await fileExists(filePath)) {
                return filePath;
            }
        }
        return null;
    }

    // Helper function to find results/predictions file
    async function findResultsFile(experimentPath) {
        const candidates = ['llm_evaluation_results.json', 'test_predictions.json', 'test_predictions_vllm.json'];
        for (const candidate of candidates) {
            const filePath = path.join(experimentPath, candidate);
            if (await fileExists(filePath)) {
                return { path: filePath, type: candidate };
            }
        }
        return null;
    }

    // List all experiments
    router.get('/api/experiments', requireServerAuth, requireMetricsRole, async (req, res) => {
        try {
            if (!fs.existsSync(METRICS_OUTPUT_DIR)) {
                return res.json({});
            }
            const families = await fs.promises.readdir(METRICS_OUTPUT_DIR, { withFileTypes: true });
            const result = {};

            for (const family of families) {
                if (!family.isDirectory()) continue;

                const familyPath = path.join(METRICS_OUTPUT_DIR, family.name);
                const models = await fs.promises.readdir(familyPath, { withFileTypes: true });

                const modelList = [];
                for (const model of models) {
                    if (!model.isDirectory()) continue;

                    const modelPath = path.join(familyPath, model.name);
                    const metricsFile = await findMetricsFile(modelPath);

                    let hasLlmScore = false;
                    if (metricsFile) {
                        try {
                            const metricsData = JSON.parse(await fs.promises.readFile(metricsFile, 'utf8'));
                            // Check if globales exists before accessing llm_score
                            if (metricsData.globales && metricsData.globales.llm_score !== undefined) {
                                hasLlmScore = true;
                            }
                        } catch (e) {
                            console.error(`Error reading metrics for ${model.name}:`, e);
                        }
                    } else {
                        console.warn(`[METRICS] Warning: No metrics file found for model ${model.name} in ${family.name}`);
                    }


                    modelList.push({
                        name: model.name,
                        hasLlmScore
                    });
                }

                if (modelList.length > 0) {
                    result[family.name] = modelList;
                }
            }

            res.json(result);
        } catch (error) {
            console.error("Error listing experiments:", error);
            res.status(500).json({ error: "Failed to list experiments" });
        }
    });

    // Get metrics for a specific experiment
    router.get('/api/experiments/:family/:id/metrics', requireServerAuth, requireMetricsRole, async (req, res) => {
        try {
            const { family, id } = req.params;
            const experimentPath = path.join(METRICS_OUTPUT_DIR, family, id);

            const metricsFile = await findMetricsFile(experimentPath);
            if (!metricsFile) {
                return res.status(404).json({ error: "Metrics not found" });
            }

            const data = await fs.promises.readFile(metricsFile, 'utf8');
            res.json(JSON.parse(data));
        } catch (error) {
            console.error(`Error reading metrics for ${req.params.family}/${req.params.id}:`, error);
            res.status(404).json({ error: "Metrics not found" });
        }
    });

    // Get results/predictions for a specific experiment
    router.get('/api/experiments/:family/:id/results', requireServerAuth, requireMetricsRole, async (req, res) => {
        try {
            const { family, id } = req.params;
            const experimentPath = path.join(METRICS_OUTPUT_DIR, family, id);

            const resultsFile = await findResultsFile(experimentPath);
            if (!resultsFile) {
                return res.status(404).json({ error: "Results not found" });
            }

            const data = await fs.promises.readFile(resultsFile.path, 'utf8');
            const parsedData = JSON.parse(data);

            // Normalize response format based on file type
            let response;
            if (resultsFile.type === 'llm_evaluation_results.json') {
                // Already has the expected format with 'details' array
                response = parsedData;
            } else {
                // test_predictions.json or test_predictions_vllm.json - wrap in consistent format
                response = {
                    details: Array.isArray(parsedData) ? parsedData : parsedData.predictions || [],
                    source: resultsFile.type
                };
            }

            res.json(response);
        } catch (error) {
            console.error(`Error reading results for ${req.params.family}/${req.params.id}:`, error);
            res.status(404).json({ error: "Results not found" });
        }
    });

    return router;
};
