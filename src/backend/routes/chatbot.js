const express = require('express');
const router = express.Router();

module.exports = function (deps) {
    const { persistentChatbot, CHATBOT_CONFIG, chatbot_logger } = deps.chatbotService;

    // Endpoint del chatbot - VERSIÓN MEJORADA
    router.post('/api/chat', async (req, res) => {
        const requestId = Date.now();

        try {
            chatbot_logger.log(`[REQ-${requestId}] Nueva petición recibida`);

            const { message, conversation_id, action = 'chat' } = req.body;

            // Validación de entrada
            if (!message && action === 'chat') {
                chatbot_logger.error(`[REQ-${requestId}] Mensaje vacío`);
                return res.status(400).json({
                    error: 'El mensaje es requerido'
                });
            }

            if (message && typeof message !== 'string') {
                chatbot_logger.error(`[REQ-${requestId}] Tipo de mensaje inválido`);
                return res.status(400).json({
                    error: 'El mensaje debe ser una cadena de texto'
                });
            }

            if (message && message.length > CHATBOT_CONFIG.MAX_MESSAGE_LENGTH) {
                chatbot_logger.error(`[REQ-${requestId}] Mensaje demasiado largo`);
                return res.status(400).json({
                    error: `El mensaje no puede exceder ${CHATBOT_CONFIG.MAX_MESSAGE_LENGTH} caracteres`
                });
            }

            if (!persistentChatbot.isReady) {
                chatbot_logger.error(`[REQ-${requestId}] Chatbot no está listo`);
                return res.status(503).json({
                    error: 'El chatbot se está inicializando',
                    retry: true
                });
            }

            chatbot_logger.log(`[REQ-${requestId}] Conv: ${conversation_id}, Action: ${action}`);

            // Enviar con conversation_id
            const response = await persistentChatbot.sendMessage(message, conversation_id, action);

            if (response.error) {
                chatbot_logger.error(`[REQ-${requestId}] Error: ${response.error}`);
                return res.status(500).json({
                    error: response.error,
                    details: response.details
                });
            }

            chatbot_logger.log(`[REQ-${requestId}] Respuesta enviada`);
            res.json(response);

        } catch (error) {
            chatbot_logger.error(`[REQ-${requestId}] Error: ${error.message}`);

            if (error.message.includes('cerrado') || error.message.includes('no está listo')) {
                persistentChatbot.restart().catch(err => {
                    chatbot_logger.error(`Error al reiniciar: ${err.message}`);
                });
            }

            res.status(500).json({
                error: 'Error interno del servidor',
                details: error.message,
                retry: true
            });
        }
    });

    // Endpoint: Editar informe via chatbot persistente
    router.post('/api/chat/edit-persistent', async (req, res) => {
        const requestId = Date.now();
        try {
            chatbot_logger.log(`[REQ-${requestId}] Petición de edición recibida`);

            const { clientId, message } = req.body;

            if (!clientId || !message) {
                chatbot_logger.error(`[REQ-${requestId}] Faltan parámetros (clientId, message)`);
                return res.status(400).json({
                    error: 'Faltan parámetros requeridos'
                });
            }

            // Enviar al chatbot persistente
            const response = await persistentChatbot.sendMessage(
                JSON.stringify({ clientId, instruction: message }),
                clientId,
                'edit'
            );

            if (response.error) {
                chatbot_logger.error(`[REQ-${requestId}] Error del chatbot: ${response.error}`);
                return res.status(500).json({ error: response.error });
            }

            chatbot_logger.log(`[REQ-${requestId}] Edición completada`);
            res.json({ success: true, response: response.response });

        } catch (error) {
            chatbot_logger.error(`[REQ-${requestId}] Error interno: ${error.message}`);
            res.status(500).json({ error: 'Error interno del servidor' });
        }
    });

    // Endpoint: Limpiar conversación
    router.post('/api/chat/clear', async (req, res) => {
        try {
            const { conversation_id } = req.body;

            if (!conversation_id) {
                return res.status(400).json({
                    error: 'conversation_id requerido'
                });
            }

            const response = await persistentChatbot.sendMessage('', conversation_id, 'clear');
            res.json(response);

        } catch (error) {
            res.status(500).json({
                error: error.message
            });
        }
    });

    // Endpoint para verificar estado del chatbot
    router.get('/api/chat/status', (req, res) => {
        res.json({
            ready: persistentChatbot.isReady,
            status: persistentChatbot.isReady ? 'ready' : 'initializing'
        });
    });

    // Endpoint para reiniciar el chatbot (solo admin)
    router.post('/api/chat/restart', async (req, res) => {
        try {
            chatbot_logger.log('Reiniciando chatbot manualmente...');
            await persistentChatbot.restart();
            res.json({ success: true, message: 'Chatbot reiniciado' });
        } catch (error) {
            chatbot_logger.error(`Error al reiniciar: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};
