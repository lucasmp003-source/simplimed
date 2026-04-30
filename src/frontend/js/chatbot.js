class Chatbot {
    constructor() {
        this.injectChatbotHTML();

        this.chatWindow = document.getElementById('chat-window');
        this.chatMessages = document.getElementById('chat-messages');
        this.userInput = document.getElementById('user-input');
        this.sendButton = document.getElementById('send-message');
        this.chatToggle = document.getElementById('chat-toggle');
        this.minimizeBtn = document.getElementById('minimize-chat');

        this.retryAttempts = 0;
        this.maxRetries = 3;
        this.isCheckingStatus = false;
        this.statusCheckTimeout = null; // Control de timeouts
        this.conversationId = this.getOrCreateConversationId();
        this.isProcessing = false;

        console.log(`[CHATBOT] Conversation ID: ${this.conversationId}`);

        this.initializeEventListeners();
        this.initializeDragFunctionality(); // Inicializar funcionalidad de arrastre
        this.checkChatbotStatus();
    }

    injectChatbotHTML() {
        if (document.getElementById('chatbot-interface')) return;

        const chatbotHTML = `
        <div class="assistant" id="chatbot-interface">
            <div class="chat-window" id="chat-window">
                <div class="chat-header">
                    <div class="header-content">
                        <h3>GALENO-IA Asistente</h3>
                    </div>
                    <button class="minimize-btn" id="minimize-chat" aria-label="Cerrar chat">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                            stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <div class="chat-messages" id="chat-messages">
                    <div class="message bot">
                        <div class="message-content">
                            <p>¡Hola! Soy el asistente de GALENO-IA. ¿En qué puedo ayudarte?</p>
                        </div>
                    </div>
                </div>

                <div class="chat-input">
                    <textarea id="user-input" placeholder="Escribe tu pregunta aquí..." rows="1"></textarea>
                    <button class="send-button" id="send-message" aria-label="Enviar mensaje">
                        <svg width="20" height="20" viewBox="0 0 24 24">
                            <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                        </svg>
                    </button>
                </div>
            </div>
            <div class="assistant-avatar" id="chat-toggle">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke-linecap="round" stroke-linejoin="round" />
                    <path d="M12 11v4m-2-2h4" stroke-linecap="round" />
                </svg>
            </div>
        </div>
        `;

        document.body.insertAdjacentHTML('beforeend', chatbotHTML);
    }

    initializeEventListeners() {
        // Toggle chat window
        this.chatToggle.addEventListener('click', () => {
            this.chatWindow.classList.toggle('active');
            this.updateChatbotAriaLabel();

            if (this.chatWindow.classList.contains('active') && !this.isCheckingStatus) {
                this.checkChatbotStatus();
            }
        });

        // Minimize chat window
        this.minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // Evitar propagación de eventos
            this.chatWindow.classList.remove('active');
            this.updateChatbotAriaLabel();
            this.chatToggle.focus(); // Mantener foco en botón toggle
        });

        // Send message on button click
        this.sendButton.addEventListener('click', () => {
            this.sendMessage();
        });

        // Send message on Enter key (but allow new lines with Shift+Enter)
        this.userInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea con límites
        this.userInput.addEventListener('input', () => {
            this.resizeTextarea();
        });

        // Limpiar al desmontar (si es necesario)
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    /**
     * Inicializa la funcionalidad de arrastre para el panel del chat
     */
    initializeDragFunctionality() {
        const header = this.chatWindow.querySelector('.chat-header');
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            // Evitar arrastre si se hace clic en botones dentro del header (como cerrar)
            if (e.target.closest('button')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Obtener posición actual o computada
            const rect = this.chatWindow.getBoundingClientRect();

            // Si aún no tiene left/top definidos (está posicionado con right/bottom),
            // necesitamos establecerlos explícitamente para empezar a mover desde ahí
            if (this.chatWindow.style.left === '' || this.chatWindow.style.left === 'auto') {
                this.chatWindow.style.left = rect.left + 'px';
                this.chatWindow.style.top = rect.top + 'px';
                // Importante: eliminar right/bottom para que left/top manden
                this.chatWindow.style.right = 'auto';
                this.chatWindow.style.bottom = 'auto';
                this.chatWindow.style.margin = '0'; // Eliminar márgenes que puedan afectar
            }

            initialLeft = parseFloat(this.chatWindow.style.left || 0);
            initialTop = parseFloat(this.chatWindow.style.top || 0);

            // Cambiar cursor para indicar arrastre activo
            header.style.cursor = 'grabbing';
            document.body.style.userSelect = 'none'; // Evitar selección de texto
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Calcular nueva posición
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // Límites para no perder la ventana (viewport)
            const windowWidth = window.innerWidth;
            const windowHeight = window.innerHeight;
            const chatRect = this.chatWindow.getBoundingClientRect();

            // Mantener dentro de los bordes horizontales (con margen de 20px)
            if (newLeft < 0) newLeft = 0;
            if (newLeft + chatRect.width > windowWidth) newLeft = windowWidth - chatRect.width;

            // Mantener dentro de los bordes verticales
            if (newTop < 0) newTop = 0;
            if (newTop + chatRect.height > windowHeight) newTop = windowHeight - chatRect.height;

            this.chatWindow.style.left = newLeft + 'px';
            this.chatWindow.style.top = newTop + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'move';
                document.body.style.userSelect = ''; // Restaurar selección
            }
        });
    }

    /**
     * Redimensiona el textarea limitando altura máxima
     */
    resizeTextarea() {
        // Resetear altura para medir scroll height
        this.userInput.style.height = 'auto';

        // Calcular nueva altura (máx 120px)
        const maxHeight = 120;
        const newHeight = Math.min(this.userInput.scrollHeight, maxHeight);

        this.userInput.style.height = newHeight + 'px';
        this.userInput.style.overflowY = newHeight >= maxHeight ? 'auto' : 'hidden';
    }

    /**
     * Actualiza el label ARIA del toggle
     */
    updateChatbotAriaLabel() {
        const isOpen = this.chatWindow.classList.contains('active');
        this.chatToggle.setAttribute('aria-label',
            isOpen ? 'Cerrar asistente de chat' : 'Abrir asistente de chat'
        );
        this.chatToggle.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
    }

    /**
     * Obtiene o crea un ID de conversación único
     */
    getOrCreateConversationId() {
        const STORAGE_KEY = 'chatbot_conversation_id';
        let convId = sessionStorage.getItem(STORAGE_KEY);

        if (!convId) {
            convId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            sessionStorage.setItem(STORAGE_KEY, convId);
        }

        return convId;
    }

    /**
     * Verifica estado del chatbot con control de timeouts
     */
    async checkChatbotStatus() {
        if (this.isCheckingStatus) return;

        this.isCheckingStatus = true;
        console.log('[CHATBOT] Verificando estado del chatbot...');

        try {
            const response = await fetch(`${window.BASE_PATH}/api/chat/status`);

            if (!response.ok) {
                throw new Error(`Error al verificar estado: ${response.status}`);
            }

            const data = await response.json();
            console.log('[CHATBOT] Estado:', data);

            if (!data.ready) {
                console.log('[CHATBOT] El chatbot se está inicializando...');
                this.showStatusMessage('El asistente se está inicializando, por favor espera unos segundos...', 'info');

                // Limpiar timeout anterior si existe
                if (this.statusCheckTimeout) {
                    clearTimeout(this.statusCheckTimeout);
                }

                // Crear nuevo timeout
                this.statusCheckTimeout = setTimeout(() => {
                    this.isCheckingStatus = false;
                    this.checkChatbotStatus();
                }, 3000);
            } else {
                console.log('[CHATBOT] ✅ Chatbot listo');
                this.removeStatusMessage();
            }
        } catch (error) {
            console.error('[CHATBOT] Error al verificar estado:', error);
            this.showStatusMessage('Error al conectar con el asistente. Reintentando...', 'warning');

            // Limpiar timeout anterior si existe
            if (this.statusCheckTimeout) {
                clearTimeout(this.statusCheckTimeout);
            }

            // Crear nuevo timeout
            this.statusCheckTimeout = setTimeout(() => {
                this.isCheckingStatus = false;
                this.checkChatbotStatus();
            }, 5000);
        } finally {
            this.isCheckingStatus = false;
        }
    }

    showStatusMessage(message, type = 'info') {
        let statusMsg = document.getElementById('chatbot-status-message');

        if (!statusMsg) {
            statusMsg = document.createElement('div');
            statusMsg.id = 'chatbot-status-message';
            statusMsg.className = 'status-message';
            statusMsg.setAttribute('role', 'status');
            statusMsg.setAttribute('aria-live', 'polite');
            this.chatMessages.insertBefore(statusMsg, this.chatMessages.firstChild);
        }

        statusMsg.className = `status-message ${type}`;
        statusMsg.innerHTML = `
            <div class="status-content">
                <span class="status-icon" aria-hidden="true">${type === 'info' ? '⏳' : '⚠️'}</span>
                <span class="status-text">${this.escapeHtml(message)}</span>
            </div>
        `;
    }

    removeStatusMessage() {
        const statusMsg = document.getElementById('chatbot-status-message');
        if (statusMsg) {
            statusMsg.remove();
        }
    }

    /**
     * Función principal para enviar mensajes
     */
    async sendMessage() {
        const message = this.userInput.value.trim();

        if (!message) {
            return;
        }

        if (this.isProcessing) {
            console.log('[CHATBOT] Ya hay un mensaje en proceso');
            return;
        }

        // MODO EDICIÓN: Si el informe ya se generó, el chat actúa como editor
        if (window.isEditingMode) {
            this.handleEditRequest(message);
            return;
        }

        // Deshabilitar input y botón
        this.userInput.disabled = true;
        this.sendButton.disabled = true;
        this.isProcessing = true;

        // Mostrar mensaje del usuario
        this.addMessage(message, 'user');

        // Limpiar input
        this.userInput.value = '';
        this.userInput.style.height = 'auto';

        // Mostrar indicador de escritura
        this.addTypingIndicator();

        try {
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
            const basePath = window.BASE_PATH || '';

            const response = await fetch(`${basePath}/api/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    message: message,
                    conversation_id: this.conversationId
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error en la petición');
            }

            this.removeTypingIndicator();
            this.addMessage(data.response, 'bot');
            this.retryAttempts = 0;

        } catch (error) {
            console.error('[CHATBOT] Error al enviar mensaje:', error);

            this.removeTypingIndicator();

            if (error.message.includes('inicializando') && this.retryAttempts < this.maxRetries) {
                this.retryAttempts++;
                this.addMessage(
                    `El asistente se está inicializando. Reintentando (${this.retryAttempts}/${this.maxRetries})...`,
                    'bot'
                );

                setTimeout(() => {
                    this.userInput.value = message;
                    this.sendMessage();
                }, 3000);
            } else {
                this.addMessage(
                    `Lo siento, ha ocurrido un error: ${error.message}. Por favor, intenta de nuevo.`,
                    'bot'
                );
            }
        } finally {
            this.userInput.disabled = false;
            this.sendButton.disabled = false;
            this.isProcessing = false;

            // Solo enfocar en desktop, no en móvil
            if (window.innerWidth > 768) {
                this.userInput.focus();
            }
        }
    }


    /**
     * Maneja la solicitud de edición del informe
     */
    async handleEditRequest(message) {
        this.userInput.disabled = true;
        this.sendButton.disabled = true;
        this.isProcessing = true;

        this.addMessage(message, 'user');
        this.userInput.value = '';
        this.userInput.style.height = 'auto';
        this.addTypingIndicator();

        try {
            const params = new URLSearchParams(window.location.search);
            // Support both 'fileName' (simplification) and 'token' (generation)
            const clientId = params.get('fileName') || params.get('token');
            const basePath = window.BASE_PATH || '';

            if (!clientId) {
                throw new Error('No se encontró identificador del documento (fileName o token)');
            }

            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            const response = await fetch(`${basePath}/api/chat/edit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    clientId: clientId,
                    message: message
                })
            });

            const data = await response.json();

            this.removeTypingIndicator();

            if (!response.ok) {
                throw new Error(data.error || 'Error en la edición');
            }

            this.addMessage("✅ Informe actualizado correctamente. Actualizando vista previa...", 'bot');

            // Refrescar la vista previa llamando a la función global expuesta en preview.js
            if (window.refreshPreview) {
                setTimeout(() => window.refreshPreview(), 1000);
            }

        } catch (error) {
            console.error('[CHATBOT] Error en edición:', error);
            this.removeTypingIndicator();
            this.addMessage(`❌ Error al editar el informe: ${error.message}`, 'bot');
        } finally {
            this.userInput.disabled = false;
            this.sendButton.disabled = false;
            this.isProcessing = false;
            if (window.innerWidth > 768) this.userInput.focus();
        }
    }

    /**
     * Limpia el historial de la conversación actual
     */
    async clearConversation() {
        try {
            const basePath = window.BASE_PATH || '';
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

            const response = await fetch(`${basePath}/api/chat/clear`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    conversation_id: this.conversationId
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Error al limpiar conversación');
            }

            console.log('[CHATBOT] Conversación limpiada');

            this.chatMessages.innerHTML = '';
            this.addMessage('Nueva conversación iniciada', 'bot');

            return data;

        } catch (error) {
            console.error('[CHATBOT] Error limpiando conversación:', error);
            throw error;
        }
    }

    /**
     * Inicia una nueva conversación
     */
    startNewConversation() {
        sessionStorage.removeItem('chatbot_conversation_id');
        this.conversationId = this.getOrCreateConversationId();
        console.log(`[CHATBOT] Nueva conversación iniciada: ${this.conversationId}`);

        this.chatMessages.innerHTML = '';
        this.addMessage('Nueva conversación iniciada', 'bot');
    }

    addMessage(message, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.setAttribute('role', type === 'bot' ? 'status' : 'article');
        messageDiv.setAttribute('aria-live', type === 'bot' ? 'polite' : 'off');

        const formattedMessage = this.formatMessage(message);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        contentDiv.innerHTML = formattedMessage;

        messageDiv.appendChild(contentDiv);
        this.chatMessages.appendChild(messageDiv);

        this.scrollToBottom();
    }

    formatMessage(message) {
        let formatted = this.escapeHtml(message);

        let blocks = formatted.split(/\n\n+/);
        let result = [];

        blocks.forEach(block => {
            block = block.trim();
            if (!block) return;

            let lines = block.split('\n');
            let isBulletList = lines.every(line => /^[\-\*]\s+/.test(line.trim()));
            let isNumberedList = lines.every(line => /^\d+\.\s+/.test(line.trim()));

            if (isBulletList) {
                let items = lines.map(line => {
                    let content = line.replace(/^[\-\*]\s+/, '').trim();
                    content = this.applyInlineFormatting(content);
                    return `<li>${content}</li>`;
                }).join('');
                result.push(`<ul>${items}</ul>`);
            } else if (isNumberedList) {
                let items = lines.map(line => {
                    let content = line.replace(/^\d+\.\s+/, '').trim();
                    content = this.applyInlineFormatting(content);
                    return `<li>${content}</li>`;
                }).join('');
                result.push(`<ol>${items}</ol>`);
            } else {
                let content = block.replace(/\n/g, '<br>');
                content = this.applyInlineFormatting(content);
                result.push(`<p>${content}</p>`);
            }
        });

        return result.join('');
    }

    applyInlineFormatting(text) {
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
        text = text.replace(/\*([^\*]+?)\*/g, '<em>$1</em>');
        text = text.replace(/_([^_]+?)_/g, '<em>$1</em>');
        return text;
    }

    addTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot typing';
        typingDiv.id = 'typing-indicator';
        typingDiv.setAttribute('role', 'status');
        typingDiv.setAttribute('aria-label', 'El asistente está escribiendo');

        typingDiv.innerHTML = `
            <div class="message-content">
                <div class="typing-indicator" aria-hidden="true">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            </div>
        `;

        this.chatMessages.appendChild(typingDiv);
        this.scrollToBottom();
    }

    removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    scrollToBottom() {
        // Usar requestAnimationFrame para asegurar que el scroll ocurra después del render
        requestAnimationFrame(() => {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        });
    }

    escapeHtml(unsafe) {
        const div = document.createElement('div');
        div.textContent = unsafe;
        return div.innerHTML;
    }

    /**
     * Limpia recursos al destruir la instancia
     */
    cleanup() {
        if (this.statusCheckTimeout) {
            clearTimeout(this.statusCheckTimeout);
            this.statusCheckTimeout = null;
        }
        console.log('[CHATBOT] Recursos limpios');
    }
}

// Initialize chatbot when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('[CHATBOT] Inicializando cliente del chatbot...');
    const chatbot = new Chatbot();
    console.log('[CHATBOT] Cliente del chatbot inicializado correctamente');

    window.chatbot = chatbot;
});
